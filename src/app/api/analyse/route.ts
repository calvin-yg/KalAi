import { NextResponse } from "next/server";
import { AnalysisError, analyseMeal } from "@/lib/analyse";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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

export async function POST(request: Request) {
  let body: { image?: unknown; description?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const description =
    typeof body.description === "string" ? body.description.slice(0, 600).trim() : "";

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

  if (!imageBase64 && !description) {
    return NextResponse.json(
      { error: "Add a photo or describe what you ate." },
      { status: 400 },
    );
  }

  try {
    const analysis = await analyseMeal({ imageBase64, imageMediaType, description });
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
    console.error("analyse failed", error);
    return NextResponse.json({ error: "Something went wrong analysing that meal." }, { status: 500 });
  }
}
