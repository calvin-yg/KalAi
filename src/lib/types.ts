export type Sex = "female" | "male";

export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "active"
  | "very_active";

export type GoalType = "lose" | "maintain" | "gain";

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface Macros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface Profile {
  name: string;
  sex: Sex;
  birthYear: number;
  heightCm: number;
  weightKg: number;
  activity: ActivityLevel;
  goal: GoalType;
  /** Target rate of change in kg per week. Always stored as a positive number. */
  rateKgPerWeek: number;
  /** Null means "derive from the profile". A number means the user overrode it. */
  customCalories: number | null;
  createdAt: string;
}

/** One recognised component of a meal, e.g. "grilled chicken breast". */
export interface FoodItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  grams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** 0-1, how sure the model is about this item's identity and portion. */
  confidence: number;
}

export interface Entry {
  id: string;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  createdAt: string;
  meal: MealType;
  title: string;
  items: FoodItem[];
  totals: Macros;
  /** 1-10 nutritional quality score from the model. */
  healthScore: number;
  notes: string;
  /**
   * Filename of the stored photo under the photos directory, or null for meals
   * that were described or scanned. Served through /api/photos/<name>.
   */
  photo: string | null;
  source: "photo" | "text" | "barcode";
  /** Set when the entry came from a scanned product. */
  barcode?: string;
  /** True once the user has adjusted portions by hand. */
  edited: boolean;
}

export interface WeighIn {
  date: string;
  weightKg: number;
}

/** Everything belonging to one person. */
export interface UserRecord {
  id: string;
  profile: Profile | null;
  entries: Entry[];
  weighIns: WeighIn[];
}

export interface Database {
  /** Keyed by user id. Two people share one deployment; there is no cross-user view. */
  users: Record<string, UserRecord>;
}

/** What the app needs to render the user switcher. */
export interface UserSummary {
  id: string;
  name: string;
}

export interface DayTargets extends Macros {
  /** Maintenance calories (TDEE), before the goal adjustment. */
  maintenance: number;
  bmr: number;
}

/** A packaged product looked up by barcode, normalised to per-100 g figures. */
export interface Product {
  barcode: string;
  name: string;
  brand: string;
  /** Pack size as printed, e.g. "375 mL". Empty when unknown. */
  packSize: string;
  /** Grams (or millilitres) in one serving as printed, or null when unstated. */
  servingGrams: number | null;
  /** Serving size as printed, e.g. "2 biscuits (30 g)". Empty when unknown. */
  servingLabel: string;
  per100g: Macros;
  /** Where the numbers came from, shown to the user. */
  source: "openfoodfacts";
  imageUrl: string | null;
}
