import { NextResponse } from "next/server";
import { AnalysisError, analyseMeal } from "@/lib/analyse";
import { RateLimiter, clientKey, readJson } from "@/lib/http";
import { errorResponse, tooManyRequests } from "@/lib/responses";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// A downscaled photo is ~200 KB of base64; 8 MB leaves generous headroom.
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * Every call here costs real money at the API. Two people photographing meals
 * will never come close to 20 in 5 minutes; a loop or a stranger would.
 */
const limiter = new RateLimiter(20, 5 * 60 * 1000);

const MEDIA_TYPES = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

type SupportedMediaType = (typeof MEDIA_TYPES)[keyof typeof MEDIA_TYPES];

/** Split a data URL into its media type and bare base64 payload. */
function parseDataUrl(
  dataUrl: string,
): { mediaType: SupportedMediaType; data: string } | null {
  const match = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/s.exec(dataUrl.trim());
  if (!match) return null;
  return { mediaType: MEDIA_TYPES[match[1] as keyof typeof MEDIA_TYPES], data: match[2] };
}

const text = (value: unknown, max: number): string =>
  typeof value === "string" ? value.slice(0, max) : "";

const round = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
};

/** Render a prior estimate as plain lines, taking only the fields we know. */
function summarisePrevious(raw: unknown): string {
  const previous = (raw ?? {}) as Record<string, unknown>;
  const items = Array.isArray(previous.items) ? previous.items.slice(0, 20) : [];
  if (items.length === 0) return "";

  const lines = items.map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    return (
      `- ${text(item.name, 80) || "item"}: ${round(item.grams)} g, ` +
      `${round(item.calories)} kcal, protein ${round(item.protein)} g, ` +
      `carbs ${round(item.carbs)} g, fat ${round(item.fat)} g`
    );
  });

  const title = text(previous.title, 140);
  const total = items.reduce(
    (sum, entry) => sum + round((entry as Record<string, unknown>).calories),
    0,
  );

  return `${title || "Meal"} — ${total} kcal total\n${lines.join("\n")}`;
}

export async function POST(request: Request) {
  const wait = limiter.check(clientKey(request));
  if (wait !== null) {
    return tooManyRequests(wait, "That's a lot of meals at once — try again shortly.");
  }

  let body: Record<string, unknown>;
  try {
    body = await readJson(request, MAX_BODY_BYTES);
  } catch (error) {
    return errorResponse(error, "Could not read that request.");
  }

  const description =
    typeof body.description === "string" ? body.description.slice(0, 600).trim() : "";

  const correction =
    typeof body.correction === "string" ? body.correction.slice(0, 600).trim() : "";

  // Rebuilt server-side from a known shape rather than trusting a blob of text,
  // so nothing the client sends can be dressed up as an instruction.
  const previous = correction ? summarisePrevious(body.previous) : "";

  let imageBase64: string | undefined;
  let imageMediaType: SupportedMediaType | undefined;

  if (typeof body.image === "string" && body.image.length > 0) {
    const parsed = parseDataUrl(body.image);
    if (!parsed) {
      return NextResponse.json(
        { error: "The photo must be a JPEG, PNG or WebP data URL." },
        { status: 400 },
      );
    }
    // base64 inflates by 4/3; check the decoded size.
    if ((parsed.data.length * 3) / 4 > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "That photo is too large — please use a smaller one." },
        { status: 413 },
      );
    }
    imageBase64 = parsed.data;
    imageMediaType = parsed.mediaType;
  }

  if (!imageBase64 && !description && !correction) {
    return NextResponse.json(
      { error: "Add a photo or describe what you ate." },
      { status: 400 },
    );
  }

  if (correction && !previous) {
    return NextResponse.json(
      { error: "Nothing to correct — start a new estimate instead." },
      { status: 400 },
    );
  }

  try {
    const analysis = await analyseMeal({
      imageBase64,
      imageMediaType,
      description,
      ...(correction ? { correction, previous } : {}),
    });
    if (!analysis.isFood || analysis.items.length === 0) {
      return NextResponse.json(
        {
          error:
            "No food found in that one. Try a clearer, closer photo — or describe the meal instead.",
        },
        { status: 422 },
      );
    }
    return NextResponse.json({ analysis });
  } catch (error) {
    if (error instanceof AnalysisError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return errorResponse(error, "Something went wrong analysing that meal.");
  }
}
