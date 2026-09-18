/**
 * Accuracy harness: how far are the photo estimates from what was actually eaten?
 *
 *   npm run eval -- --dry-run     # check the pipeline, no API calls, no cost
 *   npm run eval                  # the real thing
 *   npm run eval -- --runs 3      # repeat each photo, to see run-to-run spread
 *
 * Truth comes from eval/truth.csv: grams on the scales times per-100 g figures
 * off the packet. Nothing on that side is estimated, which is the whole point.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTruth,
  confidenceCalibration,
  parseCsv,
  rangeCoverage,
  runVariance,
  scoreMeal,
  summarise,
  summariseByTag,
} from "./metrics.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TRUTH_PATH = path.join(HERE, "truth.csv");
const PHOTO_DIR = path.join(HERE, "photos");
const RESULTS_DIR = path.join(HERE, "results");

// Matches src/lib/image.ts, so the harness measures what the app actually sends.
const MAX_EDGE = 1024;
const JPEG_QUALITY = 82;

/** Rough per-call cost at Sonnet 5 pricing; enough to decide with, not an invoice. */
const COST_PER_CALL_USD = 0.015;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

const DRY_RUN = flag("dry-run");
const RUNS = Math.max(1, Number(option("runs", 1)) || 1);

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

async function loadPhoto(filename) {
  const source = path.join(PHOTO_DIR, filename);
  let raw;
  try {
    raw = await fs.readFile(source);
  } catch {
    return null;
  }

  const { default: sharp } = await import("sharp");
  const resized = await sharp(raw)
    .rotate() // honour the EXIF orientation, or a phone photo arrives sideways
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  return resized.toString("base64");
}

/** A deterministic stand-in so the pipeline and report can be checked for free. */
function fakeAnalysis(meal, run) {
  const lean = 0.88 + run * 0.04; // pretend it runs a little low, and varies by run
  const scale = (value) => Math.round(value * lean);
  return {
    isFood: true,
    caloriesLow: Math.round(meal.actual.calories * 0.75),
    caloriesHigh: Math.round(meal.actual.calories * 1.05),
    title: `${meal.id} (dry run)`,
    meal: "lunch",
    healthScore: 6,
    notes: "Dry run — no model was called.",
    items: meal.ingredients.map((ingredient) => ({
      name: ingredient.name,
      quantity: 1,
      unit: "serve",
      grams: Math.round(ingredient.grams * lean),
      calories: scale(ingredient.calories),
      protein: scale(ingredient.protein),
      carbs: scale(ingredient.carbs),
      fat: scale(ingredient.fat),
      confidence: 0.6,
    })),
  };
}

function totalsOf(analysis) {
  return analysis.items.reduce(
    (acc, item) => ({
      calories: acc.calories + item.calories,
      protein: acc.protein + item.protein,
      carbs: acc.carbs + item.carbs,
      fat: acc.fat + item.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

const pct = (value) =>
  value === null || value === undefined ? "    —" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;

function printSummary(label, summary) {
  if (!summary) return;
  console.log(
    `  ${label.padEnd(9)} bias ${pct(summary.bias).padStart(7)}   ` +
      `typical error ${summary.meanAbsolute.toFixed(1).padStart(5)}%   ` +
      `median ${summary.medianAbsolute.toFixed(1).padStart(5)}%   ` +
      `worst ${summary.worst.toFixed(0).padStart(3)}%`,
  );
}

async function main() {
  let csv;
  try {
    csv = await fs.readFile(TRUTH_PATH, "utf8");
  } catch {
    fail(
      `No truth file at ${TRUTH_PATH}.\n` +
        `Copy eval/truth.example.csv to eval/truth.csv and fill in your own meals.`,
    );
  }

  const meals = buildTruth(parseCsv(csv));
  if (meals.length === 0) fail("No meals found in eval/truth.csv.");

  const withPhotos = meals.filter((meal) => meal.photo);
  if (withPhotos.length === 0) fail("No meals in eval/truth.csv name a photo.");

  const calls = withPhotos.length * RUNS;
  const model = process.env.KALAI_MODEL?.trim() || "claude-sonnet-5";
  console.log(
    `\nModel: ${model}   meals: ${withPhotos.length}   runs each: ${RUNS}   API calls: ${calls}`,
  );

  if (DRY_RUN) {
    console.log("Dry run — no API calls, no cost.\n");
  } else {
    console.log(`Estimated cost: about US$${(calls * COST_PER_CALL_USD).toFixed(2)}.`);
    if (!flag("yes")) {
      fail("Add --yes to confirm you're happy to spend that, or --dry-run to test for free.");
    }
    console.log("");
  }

  const analyse = DRY_RUN ? null : (await import("../src/lib/analyse.ts")).analyseMeal;

  const scores = [];
  const perRunCalories = {};
  const failures = [];

  for (const meal of withPhotos) {
    const image = await loadPhoto(meal.photo);
    if (!image && !DRY_RUN) {
      const failure = { id: meal.id, reason: `photo not found in eval/photos: ${meal.photo}` };
      failures.push(failure);
      console.log(`  ${meal.id.padEnd(14)} skipped — ${failure.reason}`);
      continue;
    }

    perRunCalories[meal.id] = [];

    for (let run = 0; run < RUNS; run += 1) {
      let analysis;
      try {
        analysis = DRY_RUN
          ? fakeAnalysis(meal, run)
          : await analyse({ imageBase64: image, imageMediaType: "image/jpeg" });
      } catch (error) {
        failures.push({ id: meal.id, reason: error.message });
        // Surfaced immediately: a run that fails on the first meal usually fails
        // on all of them, and the reason is what the person needs to see.
        console.log(`  ${meal.id.padEnd(14)} failed — ${error.message}`);
        continue;
      }

      const predicted = totalsOf(analysis);
      perRunCalories[meal.id].push(predicted.calories);

      // Only the first run of each meal feeds the headline accuracy numbers, so
      // that repeats measure variance without weighting some meals more heavily.
      if (run === 0) {
        const score = scoreMeal(meal, predicted);
        score.confidence =
          analysis.items.reduce((sum, item) => sum + item.confidence, 0) /
          Math.max(1, analysis.items.length);
        score.title = analysis.title;
        if (analysis.caloriesHigh > analysis.caloriesLow) {
          score.range = { low: analysis.caloriesLow, high: analysis.caloriesHigh };
        }
        scores.push(score);
      }
    }

    const latest = scores.find((s) => s.id === meal.id);
    if (latest) {
      console.log(
        `  ${meal.id.padEnd(14)} actual ${String(meal.actual.calories).padStart(5)} kcal   ` +
          `estimated ${String(latest.predicted.calories).padStart(5)} kcal   ` +
          `${pct(latest.errors.calories)}`,
      );
    }
  }

  if (scores.length === 0) {
    const reasons = [...new Set(failures.map((f) => f.reason))];
    fail(
      `Nothing was scored.\n\n${reasons.map((r) => `  • ${r}`).join("\n")}\n\n` +
        `If that's about credentials, put ANTHROPIC_API_KEY in .env.local and try again.`,
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    model: process.env.KALAI_MODEL?.trim() || "claude-sonnet-5",
    dryRun: DRY_RUN,
    runsPerMeal: RUNS,
    mealCount: scores.length,
    calories: summarise(scores, "calories"),
    protein: summarise(scores, "protein"),
    carbs: summarise(scores, "carbs"),
    fat: summarise(scores, "fat"),
    byTag: summariseByTag(scores),
    confidence: confidenceCalibration(scores),
    range: rangeCoverage(scores),
    variance: RUNS > 1 ? runVariance(perRunCalories) : null,
    scores,
    failures,
  };

  console.log("\n─────────────────────────────────────────────────────────────");
  console.log(`Accuracy over ${scores.length} meals\n`);
  for (const key of ["calories", "protein", "carbs", "fat"]) {
    printSummary(key, report[key]);
  }

  const cal = report.calories;
  console.log(
    `\n  Calories within 10%: ${cal.within10.toFixed(0)}%   ` +
      `within 20%: ${cal.within20.toFixed(0)}%   within 30%: ${cal.within30.toFixed(0)}%`,
  );

  if (Object.keys(report.byTag).length > 0) {
    console.log("\n  By tag (calories):");
    for (const [tag, summary] of Object.entries(report.byTag)) {
      console.log(
        `    ${tag.padEnd(14)} ${summary.meals} meals   bias ${pct(summary.bias)}   ` +
          `typical ${summary.meanAbsolute.toFixed(1)}%`,
      );
    }
  }

  console.log("\n  Does its confidence mean anything? (calorie error by self-reported confidence)");
  for (const [bucket, stats] of Object.entries(report.confidence)) {
    console.log(
      `    ${bucket.padEnd(16)} ${
        stats ? `${stats.meals} meals, typical ${stats.meanAbsolute.toFixed(1)}%` : "no meals"
      }`,
    );
  }

  if (report.range) {
    console.log("\n  Are the displayed ranges honest?");
    console.log(
      `    truth landed inside the range ${report.range.coveragePercent.toFixed(0)}% of the time ` +
        `(aim for 80-90%)`,
    );
    console.log(
      `    average range width: ${report.range.meanWidthPercent.toFixed(0)}% of the true calories`,
    );
    for (const miss of report.range.missed) {
      console.log(`    missed: ${miss.id} — truth ${miss.actual}, said ${miss.range.low}-${miss.range.high}`);
    }
  }

  if (report.variance) {
    console.log("\n  Run-to-run spread on the same photo:");
    for (const [id, stats] of Object.entries(report.variance)) {
      console.log(
        `    ${id.padEnd(14)} ${stats.min}–${stats.max} kcal   spread ${stats.spreadPercent.toFixed(1)}%`,
      );
    }
  }

  if (failures.length > 0) {
    console.log(`\n  ${failures.length} failed:`);
    for (const failure of failures) console.log(`    ${failure.id}: ${failure.reason}`);
  }

  console.log(`
  Read bias first. A consistent lean in one direction is what quietly derails a
  calorie target; scatter in both directions largely averages out over a fortnight.
`);

  await fs.mkdir(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = path.join(RESULTS_DIR, `${DRY_RUN ? "dry-" : ""}${stamp}.json`);
  await fs.writeFile(out, JSON.stringify(report, null, 2));
  console.log(`  Full results: ${path.relative(process.cwd(), out)}\n`);
}

await main();
