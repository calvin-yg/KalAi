import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  addEntry,
  deleteEntry,
  deletePhoto,
  readUser,
  savePhoto,
  updateEntry,
} from "@/lib/store";
import { roundMacros, sumMacros, toDateKey } from "@/lib/nutrition";
import { userIdFrom } from "@/lib/session";
import type { Entry, FoodItem, MealType } from "@/lib/types";

export const runtime = "nodejs";

const MEALS: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

const num = (value: unknown, fallback = 0): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

function toFoodItem(raw: unknown): FoodItem {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(r.id) || randomUUID(),
    name: str(r.name, "Food").slice(0, 120),
    quantity: Math.max(0, num(r.quantity, 1)),
    unit: str(r.unit, "serve").slice(0, 24),
    grams: Math.max(0, Math.round(num(r.grams))),
    calories: Math.max(0, Math.round(num(r.calories))),
    protein: Math.max(0, Math.round(num(r.protein))),
    carbs: Math.max(0, Math.round(num(r.carbs))),
    fat: Math.max(0, Math.round(num(r.fat))),
    confidence: Math.min(1, Math.max(0, num(r.confidence, 0.5))),
  };
}

/** Strip the data-URL prefix from a JPEG the client captured. */
function jpegBase64(dataUrl: string): string | null {
  const match = /^data:image\/jpeg;base64,(.+)$/s.exec(dataUrl);
  return match ? match[1] : null;
}

export async function GET(request: Request) {
  const userId = await userIdFrom(request);
  const date = new URL(request.url).searchParams.get("date");
  const user = await readUser(userId);
  const entries = date ? user.entries.filter((e) => e.date === date) : user.entries;
  return NextResponse.json({ entries });
}

export async function POST(request: Request) {
  const userId = await userIdFrom(request);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const items = Array.isArray(body.items) ? body.items.map(toFoodItem) : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "An entry needs at least one item." }, { status: 400 });
  }

  const meal = MEALS.includes(body.meal as MealType) ? (body.meal as MealType) : "snack";
  const barcode = str(body.barcode).replace(/\D/g, "").slice(0, 14);

  const id = randomUUID();

  // The photo arrives as a data URL and is written to disk, not into the log.
  let photo: string | null = null;
  if (typeof body.photo === "string") {
    const base64 = jpegBase64(body.photo);
    if (base64) photo = await savePhoto(id, base64);
  }

  const entry: Entry = {
    id,
    date: /^\d{4}-\d{2}-\d{2}$/.test(str(body.date)) ? str(body.date) : toDateKey(),
    createdAt: new Date().toISOString(),
    meal,
    title: str(body.title, "Meal").slice(0, 140),
    items,
    totals: roundMacros(sumMacros(items)),
    healthScore: Math.min(10, Math.max(1, Math.round(num(body.healthScore, 5)))),
    notes: str(body.notes).slice(0, 800),
    photo,
    source: barcode ? "barcode" : photo ? "photo" : "text",
    edited: body.edited === true,
    ...(barcode ? { barcode } : {}),
  };

  await addEntry(userId, entry);
  return NextResponse.json({ entry }, { status: 201 });
}

export async function PATCH(request: Request) {
  const userId = await userIdFrom(request);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const id = str(body.id);
  if (!id) return NextResponse.json({ error: "An entry id is required." }, { status: 400 });

  const patch: Partial<Omit<Entry, "id">> = { edited: true };
  if (Array.isArray(body.items)) {
    const items = body.items.map(toFoodItem);
    patch.items = items;
    patch.totals = roundMacros(sumMacros(items));
  }
  if (typeof body.title === "string") patch.title = body.title.slice(0, 140);
  if (MEALS.includes(body.meal as MealType)) patch.meal = body.meal as MealType;

  const entry = await updateEntry(userId, id, patch);
  if (!entry) return NextResponse.json({ error: "No such entry." }, { status: 404 });
  return NextResponse.json({ entry });
}

export async function DELETE(request: Request) {
  const userId = await userIdFrom(request);
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "An entry id is required." }, { status: 400 });

  const removed = await deleteEntry(userId, id);
  if (!removed) return NextResponse.json({ error: "No such entry." }, { status: 404 });

  // Don't leave the photo orphaned on disk.
  await deletePhoto(removed.photo);
  return NextResponse.json({ ok: true });
}
