import type {
  ActivityLevel,
  DayTargets,
  Entry,
  GoalType,
  Macros,
  Profile,
} from "./types";

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: "Sedentary — desk job, little exercise",
  light: "Lightly active — 1-3 sessions a week",
  moderate: "Moderately active — 3-5 sessions a week",
  active: "Active — 6-7 sessions a week",
  very_active: "Very active — physical job or twice-daily training",
};

export const GOAL_LABELS: Record<GoalType, string> = {
  lose: "Lose weight",
  maintain: "Maintain weight",
  gain: "Build muscle",
};

/** One kilogram of body mass is worth roughly 7700 kcal. */
const KCAL_PER_KG = 7700;

/** Never prescribe below these floors, whatever the goal maths says. */
const MIN_CALORIES: Record<Profile["sex"], number> = {
  female: 1200,
  male: 1500,
};

export function ageFromBirthYear(birthYear: number, now = new Date()): number {
  return Math.max(1, now.getFullYear() - birthYear);
}

/** Mifflin-St Jeor resting metabolic rate, in kcal per day. */
export function basalMetabolicRate(profile: Profile): number {
  const age = ageFromBirthYear(profile.birthYear);
  const base = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * age;
  return Math.round(profile.sex === "male" ? base + 5 : base - 161);
}

export function maintenanceCalories(profile: Profile): number {
  return Math.round(basalMetabolicRate(profile) * ACTIVITY_FACTORS[profile.activity]);
}

/**
 * Daily calorie and macro targets.
 *
 * Protein is set per kilogram of body weight (higher when cutting, to spare lean
 * mass), fat is held at 25% of intake, and carbohydrate takes the remainder.
 */
export function dailyTargets(profile: Profile): DayTargets {
  const bmr = basalMetabolicRate(profile);
  const maintenance = maintenanceCalories(profile);

  let calories: number;
  if (profile.customCalories && profile.customCalories > 0) {
    calories = Math.round(profile.customCalories);
  } else {
    const dailyDelta = (profile.rateKgPerWeek * KCAL_PER_KG) / 7;
    const signed =
      profile.goal === "lose"
        ? -dailyDelta
        : profile.goal === "gain"
          ? dailyDelta
          : 0;
    calories = Math.round(maintenance + signed);
  }

  calories = Math.max(MIN_CALORIES[profile.sex], calories);

  const proteinPerKg = profile.goal === "lose" ? 2.0 : profile.goal === "gain" ? 1.8 : 1.6;
  const protein = Math.round(profile.weightKg * proteinPerKg);
  const fat = Math.round((calories * 0.25) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));

  return { calories, protein, carbs, fat, maintenance, bmr };
}

export const EMPTY_MACROS: Macros = { calories: 0, protein: 0, carbs: 0, fat: 0 };

export function sumMacros(list: Macros[]): Macros {
  return list.reduce<Macros>(
    (acc, m) => ({
      calories: acc.calories + m.calories,
      protein: acc.protein + m.protein,
      carbs: acc.carbs + m.carbs,
      fat: acc.fat + m.fat,
    }),
    { ...EMPTY_MACROS },
  );
}

export function roundMacros(m: Macros): Macros {
  return {
    calories: Math.round(m.calories),
    protein: Math.round(m.protein),
    carbs: Math.round(m.carbs),
    fat: Math.round(m.fat),
  };
}

export function totalsForEntries(entries: Entry[]): Macros {
  return roundMacros(sumMacros(entries.map((e) => e.totals)));
}

/** Local calendar date as YYYY-MM-DD (never UTC — a meal belongs to the day you ate it). */
export function toDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

export function formatDateKey(key: string): string {
  const today = toDateKey();
  if (key === today) return "Today";
  if (key === shiftDateKey(today, -1)) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** Single weekday abbreviation for the week strip, e.g. "Wed". */
export function weekdayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", { weekday: "short" });
}

/** Kilojoules, for anyone reading Australian packaging. */
export function toKilojoules(calories: number): number {
  return Math.round(calories * 4.184);
}

/** Consecutive days up to today that have at least one logged meal. */
export function loggingStreak(loggedDates: string[]): number {
  const logged = new Set(loggedDates);
  let streak = 0;
  let cursor = toDateKey();
  // Today not being logged yet shouldn't break a streak before the day is out.
  if (!logged.has(cursor)) cursor = shiftDateKey(cursor, -1);
  while (logged.has(cursor)) {
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  return streak;
}

export function mealForTime(date = new Date()): Entry["meal"] {
  const hour = date.getHours();
  if (hour < 11) return "breakfast";
  if (hour < 15) return "lunch";
  if (hour < 21) return "dinner";
  return "snack";
}
