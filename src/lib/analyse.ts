import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/**
 * Food recognition and portion estimation, powered by Claude's vision.
 *
 * The model returns a strict JSON shape (structured outputs), so the route can
 * hand the result straight to the UI without any free-text parsing.
 */

export const MODEL = "claude-opus-5";

const FoodItemSchema = z.object({
  name: z
    .string()
    .describe("Short name of this component, e.g. 'grilled chicken thigh'."),
  quantity: z
    .number()
    .describe("How many units, e.g. 2 for two slices. Use 1 when unit is 'serve'."),
  unit: z
    .string()
    .describe("Unit the quantity counts, e.g. 'slice', 'cup', 'serve', 'g'."),
  grams: z.number().describe("Best estimate of the edible weight in grams."),
  calories: z.number().describe("Energy for the whole portion, in kilocalories."),
  protein: z.number().describe("Protein in grams for the whole portion."),
  carbs: z.number().describe("Carbohydrate in grams for the whole portion."),
  fat: z.number().describe("Fat in grams for the whole portion."),
  confidence: z
    .number()
    .describe("How certain you are about this item and its portion, from 0 to 1."),
});

const AnalysisSchema = z.object({
  isFood: z
    .boolean()
    .describe("False if the photo or description contains no identifiable food or drink."),
  title: z
    .string()
    .describe("A short name for the whole meal, e.g. 'Chicken and salad wrap'."),
  meal: z
    .enum(["breakfast", "lunch", "dinner", "snack"])
    .describe("Which meal this most likely is, judging by the food itself."),
  items: z.array(FoodItemSchema).describe("One entry per distinct food or drink."),
  healthScore: z
    .number()
    .describe("Overall nutritional quality from 1 (poor) to 10 (excellent)."),
  notes: z
    .string()
    .describe(
      "One or two plain-English sentences: what drove the estimate, and what you were unsure about.",
    ),
});

export type Analysis = z.infer<typeof AnalysisSchema>;
export type AnalysisItem = z.infer<typeof FoodItemSchema>;

const SYSTEM_PROMPT = `You are the food recognition engine behind a calorie tracking app used in Australia.

Your job is to look at a photo of a meal (or read a written description) and estimate what it contains.

How to estimate:
- Break the meal into its distinct components. A burger with chips is at least two items; a stir-fry is worth splitting into protein, vegetables, rice and sauce/oil.
- Judge portion size against reference objects in frame — plate width (a dinner plate is about 27 cm), cutlery, cans, hands, takeaway containers. Say what you used in the notes.
- Account for cooking fat and dressings even when they are not visible. Restaurant and takeaway food carries substantially more oil, butter and sugar than the same dish cooked at home.
- Use Australian foods and serving conventions: a standard slice of bread is about 35 g, a flat white is about 250 mL, a schooner is 425 mL, a Weet-Bix is 15 g.
- Energy values are kilocalories for the whole portion shown, not per 100 g.
- Each item's macros must be physically consistent with its calories: protein and carbohydrate are 4 kcal per gram, fat is 9 kcal per gram, alcohol is 7. The sum of the macros should land within about 10% of the stated calories.

On confidence:
- Be honest. A clearly lit, plated, single-serve meal might reach 0.85. A mixed casserole, a stacked plate, or anything where portion depth is hidden should sit near 0.4-0.6.
- If the image is too dark, too blurry, or too cropped to identify the food, set isFood to false and leave items empty rather than guessing.

Estimate as a well-calibrated nutritionist would: give the most likely value, not a cautious over-estimate and not a flattering under-estimate. This is a guide for everyday tracking, not a clinical measurement.`;

let cachedClient: Anthropic | null = null;

function client(): Anthropic {
  // Resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an `ant auth login` profile.
  //
  // The budget here is the whole wait a person spends staring at a spinner, not
  // the length of one attempt: the SDK retries, so the timeout must be under
  // half the route's 120s ceiling or a stalled call blows through it. 55s twice
  // lands at ~110s worst case, and a genuine analysis finishes well inside one.
  cachedClient ??= new Anthropic({ timeout: 55_000, maxRetries: 1 });
  return cachedClient;
}

export class AnalysisError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "AnalysisError";
    this.status = status;
  }
}

export interface AnalyseInput {
  /** Bare base64 JPEG/PNG data, with the data-URL prefix already stripped. */
  imageBase64?: string;
  imageMediaType?: "image/jpeg" | "image/png" | "image/webp";
  /** A written description, used alone or as a hint alongside the photo. */
  description?: string;
}

export async function analyseMeal(input: AnalyseInput): Promise<Analysis> {
  const content: Anthropic.ContentBlockParam[] = [];

  if (input.imageBase64) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: input.imageMediaType ?? "image/jpeg",
        data: input.imageBase64,
      },
    });
  }

  if (input.imageBase64 && input.description) {
    content.push({
      type: "text",
      text: `Analyse this meal. The person adds: "${input.description}". Treat that as ground truth where it conflicts with what you see.`,
    });
  } else if (input.imageBase64) {
    content.push({ type: "text", text: "Analyse this meal." });
  } else if (input.description) {
    content.push({
      type: "text",
      text: `There is no photo. Estimate this meal from the description alone: "${input.description}". Where the portion is unstated, assume a typical adult serve and say so in the notes.`,
    });
  } else {
    throw new AnalysisError("Provide a photo or a description.", 400);
  }

  let response;
  try {
    response = await client().messages.parse({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: zodOutputFormat(AnalysisSchema),
      },
      messages: [{ role: "user", content }],
    });
  } catch (error) {
    // When no key, token or profile is configured the SDK throws a plain Error from
    // credential resolution, before any request is built — so there is no typed class
    // to match here, only the message.
    if (
      error instanceof Error &&
      error.message.includes("Could not resolve authentication method")
    ) {
      throw new AnalysisError(
        "No Anthropic credentials found. Set ANTHROPIC_API_KEY in .env.local, then restart the server.",
        401,
      );
    }
    if (error instanceof Anthropic.AuthenticationError) {
      throw new AnalysisError(
        "Anthropic credentials are missing or invalid. Set ANTHROPIC_API_KEY or run `ant auth login`.",
        401,
      );
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new AnalysisError("Rate limited by the API — try again in a moment.", 429);
    }
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      throw new AnalysisError("That took too long — try again with a clearer photo.", 504);
    }
    if (error instanceof Anthropic.APIConnectionError) {
      throw new AnalysisError("Could not reach the Anthropic API.", 503);
    }
    if (error instanceof Anthropic.APIError) {
      throw new AnalysisError(`Anthropic API error (${error.status ?? "unknown"}).`, 502);
    }
    throw error;
  }

  if (response.stop_reason === "refusal") {
    throw new AnalysisError("The model declined to analyse this image.", 422);
  }
  if (response.stop_reason === "max_tokens") {
    throw new AnalysisError("The analysis was cut short — try a simpler photo.", 502);
  }

  const parsed = response.parsed_output;
  if (!parsed) throw new AnalysisError("The analysis came back unreadable.", 502);

  return normalise(parsed);
}

const clamp = (n: number, lo: number, hi: number) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;

/** Guard against a plausible-looking but out-of-range estimate reaching the UI. */
function normalise(analysis: Analysis): Analysis {
  return {
    ...analysis,
    healthScore: Math.round(clamp(analysis.healthScore, 1, 10)),
    items: analysis.items.map((item) => ({
      ...item,
      quantity: clamp(item.quantity, 0, 100),
      grams: Math.round(clamp(item.grams, 0, 5000)),
      calories: Math.round(clamp(item.calories, 0, 10000)),
      protein: Math.round(clamp(item.protein, 0, 1000)),
      carbs: Math.round(clamp(item.carbs, 0, 1000)),
      fat: Math.round(clamp(item.fat, 0, 1000)),
      confidence: clamp(item.confidence, 0, 1),
    })),
  };
}
