/**
 * Scoring for the accuracy harness.
 *
 * Kept free of file and network access so the maths can be unit tested on its
 * own — a measuring instrument you haven't checked is worse than no instrument,
 * because you'll believe it.
 */

/** Minimal CSV reader: handles quoted fields, embedded commas and "" escapes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((value) => value.trim() !== "")) rows.push(row);

  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, (values[index] ?? "").trim()])),
  );
}

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Group ingredient rows into meals and total what was actually eaten.
 *
 * Truth comes from the scales and the packet: grams of each ingredient times
 * its per-100 g figures. Nothing is estimated on this side of the comparison.
 */
export function buildTruth(rows) {
  const meals = new Map();

  for (const row of rows) {
    const id = row.meal_id;
    if (!id) continue;

    if (!meals.has(id)) {
      meals.set(id, {
        id,
        photo: row.photo || "",
        tags: (row.tags || "").split("|").map((t) => t.trim()).filter(Boolean),
        note: row.note || "",
        ingredients: [],
        actual: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      });
    }

    const meal = meals.get(id);
    // The first row of a meal carries its photo and tags; later rows needn't repeat them.
    if (!meal.photo && row.photo) meal.photo = row.photo;
    if (meal.tags.length === 0 && row.tags) {
      meal.tags = row.tags.split("|").map((t) => t.trim()).filter(Boolean);
    }

    const grams = number(row.grams);
    const factor = grams / 100;
    const contribution = {
      name: row.ingredient || "unnamed",
      grams,
      calories: number(row.kcal_per_100g) * factor,
      protein: number(row.protein_per_100g) * factor,
      carbs: number(row.carbs_per_100g) * factor,
      fat: number(row.fat_per_100g) * factor,
    };

    meal.ingredients.push(contribution);
    for (const key of ["calories", "protein", "carbs", "fat"]) {
      meal.actual[key] += contribution[key];
    }
  }

  for (const meal of meals.values()) {
    for (const key of ["calories", "protein", "carbs", "fat"]) {
      meal.actual[key] = Math.round(meal.actual[key]);
    }
  }

  return [...meals.values()];
}

/** Signed percentage error. Positive means the estimate was too high. */
export function signedError(predicted, actual) {
  if (actual === 0) return predicted === 0 ? 0 : null;
  return ((predicted - actual) / actual) * 100;
}

export function scoreMeal(meal, predicted) {
  const errors = {};
  for (const key of ["calories", "protein", "carbs", "fat"]) {
    errors[key] = signedError(predicted[key], meal.actual[key]);
  }
  return { id: meal.id, tags: meal.tags, actual: meal.actual, predicted, errors };
}

const mean = (values) =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Aggregate scores for one nutrient.
 *
 * `bias` is the headline number, not `meanAbsolute`. Random error averages out
 * across a fortnight of logging; a consistent lean in one direction does not,
 * and that is what quietly derails a calorie target.
 */
export function summarise(scores, key) {
  const errors = scores.map((s) => s.errors[key]).filter((e) => e !== null);
  if (errors.length === 0) return null;

  const absolute = errors.map(Math.abs);
  const within = (limit) =>
    (absolute.filter((e) => e <= limit).length / absolute.length) * 100;

  return {
    meals: errors.length,
    bias: mean(errors),
    meanAbsolute: mean(absolute),
    medianAbsolute: median(absolute),
    worst: Math.max(...absolute),
    within10: within(10),
    within20: within(20),
    within30: within(30),
  };
}

/** Break calorie accuracy down by tag, to find which meals it handles badly. */
export function summariseByTag(scores) {
  const tags = new Set(scores.flatMap((s) => s.tags));
  const out = {};
  for (const tag of tags) {
    const subset = scores.filter((s) => s.tags.includes(tag));
    if (subset.length > 0) out[tag] = summarise(subset, "calories");
  }
  return out;
}

/**
 * Does the model's self-reported confidence track its actual accuracy?
 *
 * The app shows those badges as guidance. If high-confidence meals are no more
 * accurate than low-confidence ones, the badges are decoration and should go.
 */
export function confidenceCalibration(scores) {
  const buckets = {
    "high (>=0.7)": [],
    "fair (0.45-0.7)": [],
    "rough (<0.45)": [],
  };

  for (const score of scores) {
    const error = score.errors.calories;
    if (error === null || score.confidence === undefined) continue;
    const bucket =
      score.confidence >= 0.7
        ? "high (>=0.7)"
        : score.confidence >= 0.45
          ? "fair (0.45-0.7)"
          : "rough (<0.45)";
    buckets[bucket].push(Math.abs(error));
  }

  return Object.fromEntries(
    Object.entries(buckets).map(([name, errors]) => [
      name,
      errors.length === 0 ? null : { meals: errors.length, meanAbsolute: mean(errors) },
    ]),
  );
}

/** Spread across repeat runs of the same photo — the model is not deterministic. */
export function runVariance(perRunCalories) {
  const results = {};
  for (const [id, values] of Object.entries(perRunCalories)) {
    if (values.length < 2) continue;
    const average = mean(values);
    results[id] = {
      runs: values.length,
      mean: average,
      min: Math.min(...values),
      max: Math.max(...values),
      spreadPercent: average === 0 ? 0 : ((Math.max(...values) - Math.min(...values)) / average) * 100,
    };
  }
  return results;
}

/**
 * How often the true calories fell inside the range the app displayed.
 *
 * This is what makes the range worth showing. A range that contains the truth
 * nine times in ten is doing its job; one that contains it half the time is
 * false reassurance, and one that contains it every single time is so wide it
 * says nothing. Roughly 80-90% is the target.
 */
export function rangeCoverage(scores) {
  const withRange = scores.filter((s) => s.range && s.range.high > s.range.low);
  if (withRange.length === 0) return null;

  const inside = withRange.filter(
    (s) => s.actual.calories >= s.range.low && s.actual.calories <= s.range.high,
  );

  const widths = withRange.map((s) =>
    s.actual.calories === 0 ? 0 : ((s.range.high - s.range.low) / s.actual.calories) * 100,
  );

  return {
    meals: withRange.length,
    coveragePercent: (inside.length / withRange.length) * 100,
    meanWidthPercent: widths.reduce((a, b) => a + b, 0) / widths.length,
    missed: withRange
      .filter((s) => !inside.includes(s))
      .map((s) => ({ id: s.id, actual: s.actual.calories, range: s.range })),
  };
}
