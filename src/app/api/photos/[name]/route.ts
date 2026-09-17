import { NextResponse } from "next/server";
import { readPhoto } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const photo = await readPhoto(name);
  if (!photo) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(photo), {
    headers: {
      "content-type": "image/jpeg",
      // Photos are immutable once written — the filename is the entry id.
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
