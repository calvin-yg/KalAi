# Kilo

Photograph a meal, get the calories and macros. A Cal AI-style calorie tracker built on
Claude Opus 5 vision with structured outputs.

## What it does

- **Photo → nutrition.** Take or upload a photo of a plate. The model identifies each
  component, estimates the portion in grams, and returns calories, protein, carbs and fat
  per item, plus a 1-10 nutrition score and a note on how it judged the portions.
- **Barcode scanning.** Scan a packaged product and the numbers come straight off the
  label via Open Food Facts — exact, not estimated. Pick the portion (printed serving,
  100 g, whole pack, or your own figure) and log it. Australian labels that carry only
  kilojoules are converted.
- **Describe it instead.** No photo? Type what you ate and get the same breakdown.
- **Adjust before logging.** Every item has a portion stepper (25% increments) and can be
  removed, so a wrong guess is a two-tap fix rather than a re-shoot.
- **Honest confidence.** Each item is tagged high / fair / rough, driven by the model's own
  confidence rather than a flat number, so you know which estimates to check.
- **Daily targets.** Onboarding collects age, sex, height, weight, activity and goal, then
  derives BMR (Mifflin-St Jeor), maintenance (TDEE) and a calorie target from your chosen
  pace. Protein scales with body weight, fat sits at 25% of intake, carbs take the rest.
- **The day's picture.** Calorie ring, macro bars against target, a seven-day strip, meal
  list, and a logging streak. Calories are shown in kilojoules too.
- **Two people, one deployment.** Separate profiles, targets and food logs, with a tab to
  swap between them. An optional shared passcode keeps strangers out.

## Running it

```bash
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
npm run dev            # http://localhost:3000
```

Without credentials everything works except the analysis itself, which returns a clear
401 telling you to set the key. `ant auth login` works as an alternative — the SDK picks
up the stored profile with no env var set.

```bash
npm run build && npm start   # production
npm run typecheck
npm test                     # parsing checks for the product lookup
```

## Putting it on your phones

The camera only opens in a **secure context** — HTTPS, or localhost. Over plain HTTP on a
LAN address (`http://192.168.1.x:3000`) the browser will refuse, so barcode scanning won't
start. Photos still work, because the file picker isn't restricted the same way. Two ways
to get HTTPS:

**Fly.io** (`Dockerfile` and `fly.toml` are here, and HTTPS is automatic):

```bash
fly launch --no-deploy            # keeps the bundled fly.toml
fly volumes create kilo_data -r syd -n 1 -s 1   # the log and photos live here
fly secrets set ANTHROPIC_API_KEY=sk-ant-... KILO_PASSCODE=<something you both know>
fly deploy
```

The volume matters: without it the food log and photos vanish on every restart. Keep it to
one machine — a second would get its own volume and the two would diverge.

**Tailscale**, if you'd rather it never touch the public internet: run `npm start` on a
machine at home and `tailscale serve https / http://localhost:3000`. Both phones reach it
on the tailnet with a real certificate, and nobody outside can. You can skip the passcode.

Serverless hosts (Vercel and friends) won't work as-is — the log is a file on disk and
their filesystems are ephemeral. That would mean moving storage to a database first.

### The passcode

Set `KILO_PASSCODE` and every page and API call requires it once per device; leave it
unset (localhost) and the app is open. It is a front door for the deployment, not per-user
login: you both use the same code, and the profile tabs are a convenience rather than a
security boundary. The cookie stores a hash, not the passcode itself.

## How the estimate is produced

`src/lib/analyse.ts` sends the image (or description) to `claude-opus-5` with
`messages.parse()` and a Zod schema via `zodOutputFormat`, so the response is already
typed JSON — no free-text parsing anywhere in the app. Adaptive thinking is on at medium
effort: portion estimation benefits from the model reasoning about plate geometry before
committing to a number.

The system prompt does the real work. It tells the model to split the meal into
components, judge portions against reference objects in frame, account for invisible
cooking fats, use Australian serving conventions, and keep macros arithmetically
consistent with the stated calories (4/4/9 kcal per gram). It is explicitly told to be
well calibrated rather than cautious — a tracker that systematically over-estimates is as
useless as one that flatters you.

Two layers guard the output: the schema constrains shape, and `normalise()` clamps every
number into a physically sensible range before it reaches the UI.

## Images

Photos are downscaled in the browser to 1024 px on the long edge and JPEG-encoded at 0.82
quality before upload (`src/lib/image.ts`). Phone cameras produce 8-12 MP files; the model
gains nothing from that detail and the user pays for it in upload time and mobile data.
The server rejects anything over 5 MB decoded.

## Barcodes

Scanning runs down one of two paths, because no single one covers both phones: Chrome on
Android has a native `BarcodeDetector`, and Safari on iOS has nothing, so it falls back to
ZXing decoding frames in JavaScript. Typing the digits by hand is always offered —
barcodes on curved or shiny packaging defeat both.

Lookups go to [Open Food Facts](https://world.openfoodfacts.org), which is free, open, has
good Australian coverage and needs no API key. Products it has never seen return a clear
"not in the database" and fall back to photographing the item.

## Data

`data/db.json` holds both people's profiles and food logs, written through one serialised
promise chain so two phones posting at once can't clobber each other, with an atomic
rename on write. Photos are real files under `data/photos/`, served by
`/api/photos/<name>` — inlined as data URLs they would push the JSON into the tens of
megabytes within weeks, and every read parses the whole file.

Back it up by copying the `data` directory (`fly ssh console` + `tar`, if it's on Fly).

## Layout

```
src/lib/analyse.ts     Claude vision call, schema, system prompt, output clamping
src/lib/nutrition.ts   BMR/TDEE, targets, date keys, streaks
src/lib/store.ts       Serialised JSON datastore
src/lib/image.ts       Browser-side downscaling
src/lib/products.ts    Open Food Facts lookup, kJ conversion, portion scaling
src/lib/gate.ts        Shared passcode hashing
src/middleware.ts      Passcode gate
src/app/api/analyse    POST — photo or description in, nutrition out
src/app/api/barcode    GET — barcode in, product with per-100 g figures out
src/app/api/photos     GET — stored meal photos
src/app/api/users      GET — which profiles exist, for the switcher
src/app/api/entries    GET/POST/PATCH/DELETE the food log
src/app/api/profile    GET/POST profile and targets, PUT a weigh-in
src/app/page.tsx       Day dashboard
src/app/onboarding     Setup and settings, with live target preview
src/components/        Ring, CaptureSheet, BarcodeScanner, EntrySheet
test/                  Product-parsing tests, plus a barcode video generator for
                       testing the scanner without a real camera
```

## Hardening

The app is small, but it sits on a public URL holding personal data and calling a
metered API, so the routes assume they can be reached by someone who isn't you:

- **Size caps.** Request bodies are measured as they're read, not trusted from
  `Content-Length`, and a photo over 5 MB is dropped rather than written to the volume.
  Disk is the one resource a small deployment can't recover from on its own.
- **Rate limits.** The analysis route allows 20 calls per 5 minutes per client — far
  above two people photographing meals, far below a loop burning API credit. The passcode
  route allows 10 attempts per 15 minutes, which makes a short shared code impractical to
  guess. Both are in-process, which is another reason to run a single machine.
- **Constant-time passcode comparison**, so neither the code nor its length leaks through
  response timing.
- **Windowed loading.** The dashboard fetches a 30-day window rather than the whole log,
  and only refetches when you page outside it. A year of two people logging is thousands
  of entries; sending all of them to render seven days would get slow on mobile data.
- **An error boundary**, so a render crash shows a way back instead of a white screen.
- **`TZ=Australia/Melbourne`** in the container. Entries are keyed by local calendar date,
  and a UTC container would roll the day over mid-afternoon.

## Known limits

- Estimates are estimates. Portion depth is invisible in a photo, and hidden oils and
  sugars are inferred rather than seen. Treat it as a guide, not a measurement.
- Barcode scanning is verified end to end against a synthetic camera feed, but never
  against a real phone camera in real lighting. Expect to need a steady hand; the manual
  digit entry is there for when it struggles.
- Open Food Facts is crowd-sourced. Coverage of major Australian brands is good, but a
  record can be missing, stale, or occasionally wrong. The figures shown are whatever the
  database holds.
- The passcode is shared, not per-person. Either profile can be selected by anyone who
  gets past it, so this suits people who trust each other, not a public app.
