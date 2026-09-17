import { NextResponse } from "next/server";
import { ProductLookupError, lookupBarcode, normaliseBarcode } from "@/lib/products";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("code") ?? "";
  const barcode = normaliseBarcode(raw);

  if (!barcode) {
    return NextResponse.json(
      { error: "That doesn't look like a barcode." },
      { status: 400 },
    );
  }

  try {
    const product = await lookupBarcode(barcode);
    if (!product) {
      return NextResponse.json(
        {
          error:
            "That product isn't in the database yet. Photograph it or describe it instead.",
          barcode,
        },
        { status: 404 },
      );
    }
    return NextResponse.json({ product });
  } catch (error) {
    if (error instanceof ProductLookupError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("barcode lookup failed", error);
    return NextResponse.json({ error: "Could not look that up." }, { status: 500 });
  }
}
