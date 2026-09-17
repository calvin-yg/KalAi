import { NextResponse } from "next/server";
import { readUser, recordWeighIn, saveProfile } from "@/lib/store";
import { userIdFrom } from "@/lib/session";
import { readJson } from "@/lib/http";
import { errorResponse } from "@/lib/responses";
import { ACTIVITY_FACTORS, dailyTargets, toDateKey } from "@/lib/nutrition";
import type { ActivityLevel, GoalType, Profile, Sex } from "@/lib/types";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;

const SEXES: Sex[] = ["female", "male"];
const GOALS: GoalType[] = ["lose", "maintain", "gain"];

const clamp = (n: number, lo: number, hi: number, fallback: number) => {
  const value = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(hi, Math.max(lo, value));
};

export async function GET(request: Request) {
  const userId = await userIdFrom(request);
  const user = await readUser(userId);
  return NextResponse.json({
    userId,
    profile: user.profile,
    targets: user.profile ? dailyTargets(user.profile) : null,
    weighIns: user.weighIns,
  });
}

export async function POST(request: Request) {
  const userId = await userIdFrom(request);

  let body: Record<string, unknown>;
  try {
    body = await readJson(request, MAX_BODY_BYTES);
  } catch (error) {
    return errorResponse(error, "Could not read that request.");
  }

  const existing = (await readUser(userId)).profile;
  const thisYear = new Date().getFullYear();

  const activity = (
    typeof body.activity === "string" && body.activity in ACTIVITY_FACTORS
      ? body.activity
      : (existing?.activity ?? "light")
  ) as ActivityLevel;

  const customCaloriesRaw = body.customCalories;
  const customCalories =
    customCaloriesRaw === null || customCaloriesRaw === ""
      ? null
      : customCaloriesRaw === undefined
        ? (existing?.customCalories ?? null)
        : clamp(Number(customCaloriesRaw), 800, 8000, 2000);

  const profile: Profile = {
    name: (typeof body.name === "string" ? body.name : (existing?.name ?? "")).slice(0, 60),
    sex: SEXES.includes(body.sex as Sex) ? (body.sex as Sex) : (existing?.sex ?? "female"),
    birthYear: Math.round(
      clamp(Number(body.birthYear), thisYear - 100, thisYear - 12, existing?.birthYear ?? 1990),
    ),
    heightCm: Math.round(clamp(Number(body.heightCm), 120, 230, existing?.heightCm ?? 170)),
    weightKg: Number(clamp(Number(body.weightKg), 30, 300, existing?.weightKg ?? 70).toFixed(1)),
    activity,
    goal: GOALS.includes(body.goal as GoalType)
      ? (body.goal as GoalType)
      : (existing?.goal ?? "maintain"),
    rateKgPerWeek: Number(
      clamp(Math.abs(Number(body.rateKgPerWeek)), 0, 1, existing?.rateKgPerWeek ?? 0.5).toFixed(2),
    ),
    customCalories,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };

  await saveProfile(userId, profile);

  // A new starting weight is also today's weigh-in.
  if (!existing || existing.weightKg !== profile.weightKg) {
    await recordWeighIn(userId, { date: toDateKey(), weightKg: profile.weightKg });
  }

  return NextResponse.json({ profile, targets: dailyTargets(profile) });
}

export async function PUT(request: Request) {
  const userId = await userIdFrom(request);

  let body: Record<string, unknown>;
  try {
    body = await readJson(request, MAX_BODY_BYTES);
  } catch (error) {
    return errorResponse(error, "Could not read that request.");
  }
  const weightKg = clamp(Number(body.weightKg), 30, 300, 0);
  if (!weightKg) {
    return NextResponse.json({ error: "A weight in kilograms is required." }, { status: 400 });
  }
  const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
    ? body.date
    : toDateKey();
  const weighIn = await recordWeighIn(userId, {
    date,
    weightKg: Number(weightKg.toFixed(1)),
  });
  const user = await readUser(userId);
  return NextResponse.json({
    weighIn,
    weighIns: user.weighIns,
    targets: user.profile ? dailyTargets(user.profile) : null,
  });
}
