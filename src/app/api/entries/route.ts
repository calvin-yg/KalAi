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
import { readJson } from "@/lib/http";
import { errorResponse } from "@/lib/responses";
import type { Entry, FoodItem, MealType } from "@/lib/types";

export const runtime = "nodejs";

const MEALS: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** Cap what lands on the volume — the client sends a downscaled JPEG. */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

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

/**
 * Strip the data-URL prefix from a JPEG the client captured, rejecting one
 * too large to keep. Without this an oversized photo would be written straight
 * to the volume, and disk is the one resource this app can't recover from.
 */
function jpegBase64(dataUrl: string): string | null {
  const match = /^data:image\/jpeg;base64,(.+)$/s.exec(dataUrl);
  if (!match) return null;
  if ((match[1].length * 3) / 4 > MAX_PHOTO_BYTES) return null;
  return match[1];
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Entries for a date window, plus the bare list of dates that have any entry.
 *
 * The window matters: a year of two people logging is thousands of entries, and
 * returning all of them on every dashboard load would mean megabytes over
 * mobile data to render seven days. The date list stays cheap enough to send
 * whole (one short string per logged day) and is all the streak needs.
 */
export async function GET(request: Request) {
  const userId = await userIdFrom(request);
  const params = new URL(request.url).searchParams;
  const user = await readUser(userId);

  const date = params.get("date");
  const from = params.get("from");
  const to = params.get("to");

  let entries = user.entries;
  if (date && DATE_PATTERN.test(date)) {
    entries = entries.filter((e) => e.date === date);
  } else {
    if (from && DATE_PATTERN.test(from)) entries = entries.filter((e) => e.date >= from);
    if (to && DATE_PATTERN.test(to)) entries = entries.filter((e) => e.date <= to);
  }

  const loggedDates = [...new Set(user.entries.map((e) => e.date))].sort();
  return NextResponse.json({ entries, loggedDates });
}

export async function POST(request: Request) {
  const userId = await userIdFrom(request);

  let body: Record<string, unknown>;
  try {
    body = await readJson(request, MAX_BODY_BYTES);
  } catch (error) {
    return errorResponse(error, "Could not read that request.");
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

  // Only meaningful when it brackets the total; anything else is dropped.
  const rawRange = (body.range ?? {}) as Record<string, unknown>;
  const low = Math.max(0, Math.round(num(rawRange.low, -1)));
  const high = Math.max(0, Math.round(num(rawRange.high, -1)));
  const totals = roundMacros(sumMacros(items));
  const range =
    num(rawRange.low, -1) >= 0 && high >= low && low <= totals.calories && high >= totals.calories
      ? { low, high }
      : undefined;

  const entry: Entry = {
    id,
    date: /^\d{4}-\d{2}-\d{2}$/.test(str(body.date)) ? str(body.date) : toDateKey(),
    createdAt: new Date().toISOString(),
    meal,
    title: str(body.title, "Meal").slice(0, 140),
    items,
    totals,
    healthScore: Math.min(10, Math.max(1, Math.round(num(body.healthScore, 5)))),
    ...(range ? { range } : {}),
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
    body = await readJson(request, MAX_BODY_BYTES);
  } catch (error) {
    return errorResponse(error, "Could not read that request.");
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
