/**
 * Checks for the accuracy harness's own maths. A measuring instrument you
 * haven't verified is worse than none, because you'll believe what it says.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTruth,
  confidenceCalibration,
  parseCsv,
  runVariance,
  scoreMeal,
  signedError,
  summarise,
  summariseByTag,
} from "../eval/metrics.mjs";

test("parses CSV including quoted fields with commas", () => {
  const rows = parseCsv(
    'meal_id,ingredient,note\nm1,Rice,"Weighed cooked, not raw"\nm1,Oil,plain\n',
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].note, "Weighed cooked, not raw");
  assert.equal(rows[1].ingredient, "Oil");
});

test("totals a meal from grams and per-100 g figures", () => {
  const meals = buildTruth(
    parseCsv(
      "meal_id,photo,ingredient,grams,kcal_per_100g,protein_per_100g,carbs_per_100g,fat_per_100g,tags\n" +
        "m1,a.jpg,Rice,200,130,2.7,28.2,0.3,home|bowl\n" +
        "m1,,Oil,10,884,0,0,100,\n",
    ),
  );
  assert.equal(meals.length, 1);
  // 200 g rice = 260 kcal, 10 g oil = 88.4 kcal
  assert.equal(meals[0].actual.calories, 348);
  assert.equal(meals[0].actual.fat, 11); // 0.6 + 10
  assert.equal(meals[0].photo, "a.jpg");
  assert.deepEqual(meals[0].tags, ["home", "bowl"]);
});

test("signed error says which direction the estimate went", () => {
  assert.equal(signedError(120, 100), 20);
  assert.equal(signedError(80, 100), -20);
  assert.equal(signedError(100, 100), 0);
  // An actual of zero has no meaningful percentage unless the estimate agrees.
  assert.equal(signedError(0, 0), 0);
  assert.equal(signedError(50, 0), null);
});

const meal = (id, calories, tags = []) => ({
  id,
  tags,
  actual: { calories, protein: 10, carbs: 10, fat: 10 },
});

test("bias separates a consistent lean from random scatter", () => {
  // Scatter: wrong by 20% in both directions.
  const scattered = [
    scoreMeal(meal("a", 100), { calories: 120, protein: 10, carbs: 10, fat: 10 }),
    scoreMeal(meal("b", 100), { calories: 80, protein: 10, carbs: 10, fat: 10 }),
  ];
  const scatter = summarise(scattered, "calories");
  assert.equal(scatter.bias, 0, "opposing errors should cancel in the bias");
  assert.equal(scatter.meanAbsolute, 20, "but still show as typical error");

  // Lean: consistently low.
  const leaning = [
    scoreMeal(meal("a", 100), { calories: 80, protein: 10, carbs: 10, fat: 10 }),
    scoreMeal(meal("b", 200), { calories: 160, protein: 10, carbs: 10, fat: 10 }),
  ];
  const lean = summarise(leaning, "calories");
  assert.equal(lean.bias, -20, "a consistent lean must survive averaging");
  assert.equal(lean.meanAbsolute, 20);
});

test("counts how many meals land within each band", () => {
  const scores = [
    scoreMeal(meal("a", 100), { calories: 105, protein: 10, carbs: 10, fat: 10 }),
    scoreMeal(meal("b", 100), { calories: 115, protein: 10, carbs: 10, fat: 10 }),
    scoreMeal(meal("c", 100), { calories: 160, protein: 10, carbs: 10, fat: 10 }),
  ];
  const summary = summarise(scores, "calories");
  assert.equal(Math.round(summary.within10), 33);
  assert.equal(Math.round(summary.within20), 67);
  assert.equal(summary.worst, 60);
});

test("breaks accuracy down by tag", () => {
  const scores = [
    scoreMeal(meal("a", 100, ["home"]), { calories: 100, protein: 10, carbs: 10, fat: 10 }),
    scoreMeal(meal("b", 100, ["restaurant"]), { calories: 60, protein: 10, carbs: 10, fat: 10 }),
  ];
  const byTag = summariseByTag(scores);
  assert.equal(byTag.home.bias, 0);
  assert.equal(byTag.restaurant.bias, -40);
});

test("groups calorie error by the model's self-reported confidence", () => {
  const high = scoreMeal(meal("a", 100), { calories: 105, protein: 10, carbs: 10, fat: 10 });
  high.confidence = 0.8;
  const rough = scoreMeal(meal("b", 100), { calories: 150, protein: 10, carbs: 10, fat: 10 });
  rough.confidence = 0.3;

  const calibration = confidenceCalibration([high, rough]);
  assert.equal(calibration["high (>=0.7)"].meanAbsolute, 5);
  assert.equal(calibration["rough (<0.45)"].meanAbsolute, 50);
  assert.equal(calibration["fair (0.45-0.7)"], null);
});

test("reports run-to-run spread on the same photo", () => {
  const variance = runVariance({ m1: [500, 600, 550], m2: [400] });
  assert.equal(variance.m1.runs, 3);
  assert.equal(variance.m1.min, 500);
  assert.equal(variance.m1.max, 600);
  assert.ok(Math.abs(variance.m1.spreadPercent - 18.18) < 0.1);
  // A single run has no spread to report.
  assert.equal(variance.m2, undefined);
});

test("range coverage tells an honest range from a reassuring one", async () => {
  const { rangeCoverage } = await import("../eval/metrics.mjs");

  const scored = (id, actual, low, high) => {
    const s = scoreMeal(meal(id, actual), { calories: actual, protein: 10, carbs: 10, fat: 10 });
    s.range = { low, high };
    return s;
  };

  // Three of four truths inside the stated range.
  const coverage = rangeCoverage([
    scored("a", 500, 450, 600),
    scored("b", 500, 450, 600),
    scored("c", 500, 450, 600),
    scored("d", 500, 200, 300),
  ]);
  assert.equal(coverage.meals, 4);
  assert.equal(coverage.coveragePercent, 75);
  assert.equal(coverage.missed.length, 1);
  assert.equal(coverage.missed[0].id, "d");

  // A range with no width is not a range and shouldn't be counted.
  assert.equal(rangeCoverage([scored("e", 500, 500, 500)]), null);
});
