import type { Macros, Product } from "./types";

/**
 * Packaged-food lookup against Open Food Facts — a free, open database with
 * solid Australian coverage and no API key. Barcodes give exact label figures,
 * so a scanned product is far more accurate than any photo estimate.
 */

const ENDPOINT = "https://world.openfoodfacts.org/api/v2/product";

// Open Food Facts asks every client to identify itself.
const USER_AGENT = "KalAi/0.1 (personal calorie tracker)";

const FIELDS = [
  "code",
  "product_name",
  "product_name_en",
  "brands",
  "quantity",
  "serving_size",
  "serving_quantity",
  "nutriments",
  "image_front_small_url",
].join(",");

export class ProductLookupError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ProductLookupError";
    this.status = status;
  }
}

/** EAN-8/13, UPC-A and the 12-14 digit variants all reduce to digits only. */
export function normaliseBarcode(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 14 ? digits : null;
}

const KJ_PER_KCAL = 4.184;

function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

interface Nutriments {
  [key: string]: unknown;
}

/**
 * Australian labels often carry kilojoules only, so fall back to converting
 * rather than reporting a product as having no energy value.
 */
function energyKcalPer100g(nutriments: Nutriments): number | null {
  const kcal = num(nutriments["energy-kcal_100g"]);
  if (kcal !== null) return kcal;

  const kj = num(nutriments["energy-kj_100g"]) ?? num(nutriments["energy_100g"]);
  return kj === null ? null : kj / KJ_PER_KCAL;
}

export interface OffResponse {
  status?: number;
  product?: {
    code?: string;
    product_name?: string;
    product_name_en?: string;
    brands?: string;
    quantity?: string;
    serving_size?: string;
    serving_quantity?: number | string;
    nutriments?: Nutriments;
    image_front_small_url?: string;
  };
}

/** Pull the fields we need out of an Open Food Facts payload. */
export function productFromOff(body: OffResponse, barcode: string): Product | null {
  const product = body.product;
  if (body.status === 0 || !product) return null;

  const nutriments = product.nutriments ?? {};
  const calories = energyKcalPer100g(nutriments);
  const protein = num(nutriments["proteins_100g"]);
  const carbs = num(nutriments["carbohydrates_100g"]);
  const fat = num(nutriments["fat_100g"]);

  // A product with no energy value is useless to us, even if the record exists.
  if (calories === null) return null;

  const per100g: Macros = {
    calories: Math.round(calories),
    protein: Math.round(protein ?? 0),
    carbs: Math.round(carbs ?? 0),
    fat: Math.round(fat ?? 0),
  };

  const name =
    (product.product_name_en || product.product_name || "").trim() || "Unnamed product";

  return {
    barcode,
    name,
    brand: (product.brands ?? "").split(",")[0].trim(),
    packSize: (product.quantity ?? "").trim(),
    servingGrams: num(product.serving_quantity),
    servingLabel: (product.serving_size ?? "").trim(),
    per100g,
    source: "openfoodfacts",
    imageUrl: product.image_front_small_url ?? null,
  };
}

export async function lookupBarcode(barcode: string): Promise<Product | null> {
  const url = `${ENDPOINT}/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ProductLookupError(
      "Could not reach the product database. Check your connection and try again.",
      503,
    );
  }

  // Open Food Facts returns 404 for codes it has never seen.
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new ProductLookupError("The product database is having trouble.", 502);
  }

  let body: OffResponse;
  try {
    body = (await response.json()) as OffResponse;
  } catch {
    throw new ProductLookupError("The product database sent something unreadable.", 502);
  }

  return productFromOff(body, barcode);
}

/** Scale a product's per-100 g figures to an actual portion. */
export function macrosForGrams(product: Product, grams: number): Macros {
  const factor = grams / 100;
  return {
    calories: Math.round(product.per100g.calories * factor),
    protein: Math.round(product.per100g.protein * factor),
    carbs: Math.round(product.per100g.carbs * factor),
    fat: Math.round(product.per100g.fat * factor),
  };
}

/**
 * Pull a gram/millilitre figure out of a pack-size string like "375 mL" or
 * "2 x 100 g", so we can offer a "whole pack" portion. Returns null when the
 * string isn't something we can read confidently.
 */
export function gramsFromPackSize(packSize: string): number | null {
  const text = packSize.toLowerCase().replace(/,/g, ".");

  // Multipacks: "4 x 125 g".
  const multi = /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(g|ml)\b/.exec(text);
  if (multi) {
    const total = Number(multi[1]) * Number(multi[2]);
    return total > 0 && total <= 10000 ? Math.round(total) : null;
  }

  const single = /(\d+(?:\.\d+)?)\s*(kg|l|g|ml)\b/.exec(text);
  if (!single) return null;

  const value = Number(single[1]);
  const grams = single[2] === "kg" || single[2] === "l" ? value * 1000 : value;
  return grams > 0 && grams <= 10000 ? Math.round(grams) : null;
}
