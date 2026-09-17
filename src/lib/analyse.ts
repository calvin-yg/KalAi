import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/**
 * Food recognition and portion estimation, powered by Claude's vision.
 *
 * The model returns a strict JSON shape (structured outputs), so the route can
 * hand the result straight to the UI without any free-text parsing.
 */

/**
 * Opus 5 by default. Set KILO_MODEL to try a cheaper one — Sonnet 5 is roughly
 * 60% less per call, Haiku 4.5 about 80% less. Whether either holds up on food
 * photos is a question for the accuracy harness, not for guesswork: run the
 * same meals through both and compare bias and typical error before switching.
 */
export const MODEL = process.env.KILO_MODEL?.trim() || "claude-opus-5";

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
  caloriesLow: z
    .number()
    .describe(
      "Low end of the plausible range for the whole meal, in kilocalories. Be honest: this should be roughly where you'd expect the true value to fall about one time in ten.",
    ),
  caloriesHigh: z
    .number()
    .describe(
      "High end of the plausible range for the whole meal, in kilocalories. A mixed dish where portion depth is hidden deserves a wide range; a plated single serve deserves a narrow one.",
    ),
  healthScore: z
    .number()
    .describe("Overall nutritional quality from 1 (poor) to 10 (excellent)."),
  notes: z
    .string()
    .describe(
      "One or two plain-English sentences: what drove the estimate, and what you were unsure about.",
    ),
  questions: z
    .array(z.string())
    .describe(
      "Up to three short questions whose answers would most improve this estimate — the things only the person who cooked it can tell you. Ask about what actually moves the number: fat content of the meat, oil used, portion weight, whether something is hidden under the top layer. Ask nothing you could reasonably work out from the photo. An empty list is correct when the photo already tells you enough.",
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

On the range:
- caloriesLow and caloriesHigh bracket the whole meal, and they are the honest width of your uncertainty, not a polite gesture. If the true value would surprise you outside 470-650, say 470 and 650.
- Width should track what the photo actually hides. A plated single serve in good light might run plus or minus 15%. A stacked bowl, a casserole, or anything whose depth you cannot see should be far wider — plus or minus 35% or more.
- The range is never a way to hedge a guess you could have made properly. Narrow it by reasoning about the plate, not by wishing.

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
  /** Everything the person has told us about this meal, oldest first. */
  corrections?: string[];
  /** The estimate being corrected, summarised for the model to revise. */
  previous?: string;
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

  const corrections = input.corrections?.filter((line) => line.trim().length > 0) ?? [];

  if (corrections.length > 0 && input.previous) {
    const told = corrections.map((line) => `- ${line}`).join("\n");
    content.push({
      type: "text",
      text: `You estimated this meal as:\n\n${input.previous}\n\nThe person who cooked and ate it has told you, in order:\n\n${told}\n\nRe-estimate the meal taking all of that as fact — every line, not just the last one. It outranks anything you inferred from the photo: if they say there was no oil, remove the oil; if they give a weight, make your portions add up to it; if they name a cut or fat percentage, use its real composition rather than a generic one; if they describe a batch, work out this serve's share of it.\n\nDo not ask again about anything in that list, even obliquely, and do not drift back toward your earlier assumptions on those points — they are settled. Ask only about what genuinely remains unknown, and return an empty list of questions when nothing important is left. Carry over anything their answers don't touch. Your confidence and your range should both tighten for whatever they have now settled.`,
    });
  } else if (input.imageBase64 && input.description) {
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
  } else if (corrections.length === 0) {
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
  const total = analysis.items.reduce((sum, item) => sum + (item.calories || 0), 0);

  // A range that doesn't contain its own point estimate would be nonsense on
  // screen, so widen it rather than show the two disagreeing.
  const low = Math.round(clamp(Math.min(analysis.caloriesLow, total), 0, 10000));
  const high = Math.round(clamp(Math.max(analysis.caloriesHigh, total), 0, 20000));

  return {
    ...analysis,
    caloriesLow: low,
    caloriesHigh: high,
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
