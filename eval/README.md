# Accuracy harness

Measures how far the photo estimates land from what was actually eaten.

Nothing here runs in the app — it's a test rig you run by hand, a few times a
year, to know whether the numbers on the dashboard can be trusted.

## Why bother

The barcode path reads figures off a label, so it's right by construction. The
photo path is a model looking at a picture, and its errors are invisible from
the inside: a plate that reads 600 kcal when it was really 850 looks exactly as
confident as one that's spot on. The only way to know is to weigh some meals.

## What to do

**1. Cook and eat as you normally would, but weigh things.**

Put the bowl on the kitchen scales, note each ingredient in grams before it goes
in, and photograph the finished plate the way you'd photograph it in the app —
from slightly above, with something familiar in frame.

Twenty meals shows a pattern. Thirty is comfortable. Include the food you
actually eat, not the food that's easy to measure: if half your dinners are
one-pan things in a bowl, half the test should be too.

**2. Put the photos in `eval/photos/`.**

**3. Record the truth in `eval/truth.csv`.**

Copy `truth.example.csv` to `truth.csv` and follow its shape. One row per
ingredient; rows sharing a `meal_id` are one meal. Only the first row of a meal
needs the `photo` and `tags`.

Per-100 g figures come off the packet. For unpackaged things (a chicken thigh, a
banana) use the [Australian Food Composition Database](https://www.foodstandards.gov.au/science-data/food-composition-databases)
or a supermarket product page — and note that this is the one place error can
creep into the "truth" side, so prefer packaged ingredients where you can.

`tags` are free-form, separated by `|`. Useful ones: `home`, `restaurant`,
`bowl`, `plated`, `mixed`. They're what lets the report tell you *which kinds of
meals* it handles badly, which is more actionable than one overall number.

**4. Run it.**

```bash
npm run eval -- --dry-run     # check your CSV and photos, no API calls, no cost
npm run eval -- --yes         # the real thing
npm run eval -- --yes --runs 3   # repeat each photo to see run-to-run spread
```

It prints a summary, and writes the full results to `eval/results/`.

## Reading the report

**Bias is the headline.** It's the average signed error: positive means the app
reads high, negative means it reads low. This is the number that matters,
because a consistent lean doesn't wash out. If it reads 20% low every day, you'd
eat 20% more than you think indefinitely, and only the bathroom scales would
ever tell you.

**Typical error** (mean absolute) is how wrong a single meal usually is. Scatter
in both directions largely averages out across a fortnight of logging, so a
large typical error with near-zero bias is still usable for tracking trends —
just not for any single meal.

**By tag** shows where it struggles. Expect bowls and restaurant food to be
worse than plated home cooking; the point is to find out by how much.

**Confidence buckets** ask whether the app's own confidence badges mean
anything. If high-confidence meals aren't measurably more accurate than rough
ones, the badges are decoration and should be removed rather than trusted.

**Run-to-run spread** (with `--runs 3`) separates two different problems. If the
same photo gives 520, 610 and 580 kcal, that's noise in the model. If all three
agree on 550 when the truth is 800, that's bias — a different problem with a
different fix.

## Honest limits

- Your truth is only as good as your scales and your per-100 g figures.
  Restaurant meals can't really be measured at all; tag them and read those rows
  as indicative.
- Cooking changes weight. Meat loses water, rice gains it. Be consistent about
  whether you record raw or cooked, and say which in the `note`.
- This measures the estimate as logged, before you adjust portions in the app.
  In daily use your own corrections should make it better than these numbers.
