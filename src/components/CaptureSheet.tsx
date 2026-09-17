"use client";

import { useEffect, useRef, useState } from "react";
import type { Analysis, AnalysisItem } from "@/lib/analyse";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { api } from "@/lib/client";
import { downscaleImage } from "@/lib/image";
import { mealForTime, sumMacros } from "@/lib/nutrition";
import { gramsFromPackSize, macrosForGrams } from "@/lib/products";
import type { Entry, FoodItem, MealType, Product } from "@/lib/types";

type Stage = "choose" | "describe" | "analysing" | "review" | "scan" | "product";

interface Draft extends AnalysisItem {
  id: string;
  /** Portion multiplier applied to the model's original estimate. */
  factor: number;
}

const MEALS: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

function confidenceColour(confidence: number): string {
  if (confidence >= 0.7) return "var(--good)";
  if (confidence >= 0.45) return "var(--carbs)";
  return "var(--warn)";
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.7) return "High confidence";
  if (confidence >= 0.45) return "Fair confidence";
  return "Rough estimate";
}

/** Apply a draft's portion multiplier to produce the values we actually store. */
function scaled(item: Draft): FoodItem {
  return {
    id: item.id,
    name: item.name,
    quantity: Number((item.quantity * item.factor).toFixed(2)),
    unit: item.unit,
    grams: Math.round(item.grams * item.factor),
    calories: Math.round(item.calories * item.factor),
    protein: Math.round(item.protein * item.factor),
    carbs: Math.round(item.carbs * item.factor),
    fat: Math.round(item.fat * item.factor),
    confidence: item.confidence,
  };
}

/** Quick portion choices for a scanned product: printed serving, 100 g, whole pack. */
function portionOptions(product: Product): { label: string; grams: number }[] {
  const options: { label: string; grams: number }[] = [];

  if (product.servingGrams) {
    options.push({
      label: product.servingLabel
        ? `1 serving (${product.servingLabel})`
        : `1 serving (${product.servingGrams} g)`,
      grams: Math.round(product.servingGrams),
    });
    options.push({ label: "2 servings", grams: Math.round(product.servingGrams * 2) });
  }

  options.push({ label: "100 g", grams: 100 });

  const pack = gramsFromPackSize(product.packSize);
  if (pack && !options.some((option) => option.grams === pack)) {
    options.push({ label: `Whole pack (${pack} g)`, grams: pack });
  }

  return options;
}

interface CaptureSheetProps {
  date: string;
  onClose: () => void;
  onSaved: (entry: Entry) => void;
}

export function CaptureSheet({ date, onClose, onSaved }: CaptureSheetProps) {
  const [stage, setStage] = useState<Stage>("choose");
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [meal, setMeal] = useState<MealType>(mealForTime());
  const [saving, setSaving] = useState(false);
  const [correction, setCorrection] = useState("");
  /** Everything told to the model about this meal so far, oldest first. */
  const [answers, setAnswers] = useState<string[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [grams, setGrams] = useState(100);

  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  // A sheet unmounted mid-request shouldn't try to set state afterwards.
  //
  // The flag must be re-armed on every mount, not just initialised once: React
  // runs effects mount-cleanup-mount in development, so a cleanup-only version
  // latches to false on the first pass and silently discards every response
  // that follows — a permanent spinner, with the answer already in hand.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function runAnalysis(input: {
    image?: string;
    description?: string;
    corrections?: string[];
    previous?: unknown;
  }) {
    setStage("analysing");
    setError(null);
    try {
      const { analysis: result } = await api.analyse(input);
      if (!alive.current) return;
      setAnalysis(result);
      setMeal(result.meal);
      setDrafts(
        result.items.map((item, index) => ({
          ...item,
          id: `${Date.now()}-${index}`,
          factor: 1,
        })),
      );
      setCorrection("");
      // A fresh photo starts a new conversation; a revision keeps the old one.
      setAnswers(input.corrections ?? []);
      setStage("review");
    } catch (caught) {
      if (!alive.current) return;
      setError(caught instanceof Error ? caught.message : "That didn't work.");
      // A failed revision must go back to the estimate it was revising, not to
      // the start — the person would otherwise lose a good estimate to a typo.
      setStage(input.corrections?.length ? "review" : input.image ? "choose" : "describe");
    }
  }

  async function handleBarcode(code: string) {
    setStage("analysing");
    setError(null);
    try {
      const { product: found } = await api.barcode(code);
      if (!alive.current) return;
      setProduct(found);
      // Default to one printed serving, falling back to 100 g.
      setGrams(found.servingGrams ?? 100);
      setStage("product");
    } catch (caught) {
      if (!alive.current) return;
      setError(caught instanceof Error ? caught.message : "Could not look that up.");
      setStage("scan");
    }
  }

  async function saveProduct() {
    if (!product || grams <= 0) return;
    setSaving(true);
    setError(null);
    const macros = macrosForGrams(product, grams);
    try {
      const { entry } = await api.createEntry({
        date,
        meal,
        title: product.brand ? `${product.brand} ${product.name}` : product.name,
        barcode: product.barcode,
        healthScore: 5,
        notes: `Label figures from Open Food Facts, scaled to ${grams} g.`,
        items: [
          {
            id: product.barcode,
            name: product.name,
            quantity: 1,
            unit: "serve",
            grams,
            ...macros,
            // Label data, not an estimate.
            confidence: 1,
          },
        ],
      });
      onSaved(entry);
    } catch (caught) {
      if (!alive.current) return;
      setError(caught instanceof Error ? caught.message : "Could not save that.");
      setSaving(false);
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const dataUrl = await downscaleImage(file);
      setPhoto(dataUrl);
      await runAnalysis({ image: dataUrl, description: description.trim() || undefined });
    } catch {
      setError("Could not read that photo. Try another one.");
    }
  }

  function submitCorrection() {
    const trimmed = correction.trim();
    if (trimmed.length < 2 || !analysis) return;
    void runAnalysis({
      image: photo ?? undefined,
      corrections: [...answers, trimmed],
      previous: analysis,
    });
  }

  function adjust(id: string, delta: number) {
    setDrafts((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, factor: Math.max(0, Number((item.factor + delta).toFixed(2))) }
          : item,
      ),
    );
  }

  function remove(id: string) {
    setDrafts((current) => current.filter((item) => item.id !== id));
  }

  const kept = drafts.filter((item) => item.factor > 0).map(scaled);
  const totals = sumMacros(kept);
  const touched = drafts.some((item) => item.factor !== 1) || kept.length !== drafts.length;

  /**
   * The model's range describes the meal it was shown, so adjusting portions has
   * to move the range with the total — otherwise a halved plate keeps the range
   * of a full one.
   */
  const originalCalories = analysis
    ? analysis.items.reduce((sum, item) => sum + item.calories, 0)
    : 0;
  const rangeFactor = originalCalories > 0 ? totals.calories / originalCalories : 1;
  const range = analysis
    ? {
        // Never show a range that excludes the figure printed next to it. The
        // server keeps these consistent, but the screen shouldn't depend on that.
        low: Math.min(
          Math.round(analysis.caloriesLow * rangeFactor),
          Math.round(totals.calories),
        ),
        high: Math.max(
          Math.round(analysis.caloriesHigh * rangeFactor),
          Math.round(totals.calories),
        ),
      }
    : null;

  async function save() {
    if (!analysis || kept.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const { entry } = await api.createEntry({
        date,
        meal,
        title: analysis.title,
        items: kept,
        healthScore: analysis.healthScore,
        notes: analysis.notes,
        photo,
        edited: touched,
        ...(range ? { range } : {}),
      });
      onSaved(entry);
    } catch (caught) {
      if (!alive.current) return;
      setError(caught instanceof Error ? caught.message : "Could not save that meal.");
      setSaving(false);
    }
  }

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Log a meal"
      onClick={(event) => {
        if (event.target === event.currentTarget && stage !== "analysing") onClose();
      }}
    >
      <div className="sheet">
        <div className="grabber" />

        {error && <div className="notice error">{error}</div>}

        {stage === "choose" && (
          <>
            <h3>Log a meal</h3>
            <p className="ring-sub" style={{ marginTop: 0, marginBottom: 14 }}>
              Photograph the whole plate from slightly above, with something familiar in
              frame — cutlery, a can, your hand — so portions can be judged.
            </p>

            <div className="field">
              <label htmlFor="photo-note">Anything it can&apos;t see? (optional)</label>
              <input
                id="photo-note"
                type="text"
                value={description}
                placeholder="10% lean mince, no oil, fat drained"
                onChange={(event) => setDescription(event.target.value)}
              />
              <div className="hint">
                Cooking fat, cuts of meat and hidden ingredients are where estimates go
                wrong. Whatever you type here is taken as fact over what the photo shows.
              </div>
            </div>

            <button
              className="btn primary block"
              onClick={() => cameraRef.current?.click()}
            >
              📷 Take a photo
            </button>
            <div style={{ height: 10 }} />
            <button className="btn block" onClick={() => setStage("scan")}>
              📊 Scan a barcode
            </button>
            <div style={{ height: 10 }} />
            <button className="btn block" onClick={() => libraryRef.current?.click()}>
              🖼 Choose from library
            </button>
            <div style={{ height: 10 }} />
            <button className="btn block ghost" onClick={() => setStage("describe")}>
              ✍️ Describe it instead
            </button>
            <input
              ref={cameraRef}
              className="hidden-input"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => void handleFile(event.target.files?.[0])}
            />
            <input
              ref={libraryRef}
              className="hidden-input"
              type="file"
              accept="image/*"
              onChange={(event) => void handleFile(event.target.files?.[0])}
            />
          </>
        )}

        {stage === "describe" && (
          <>
            <h3>Describe your meal</h3>
            <p className="ring-sub" style={{ marginTop: 0, marginBottom: 14 }}>
              The more detail, the better the estimate — how it was cooked, rough portion
              sizes, anything added on top.
            </p>
            <textarea
              value={description}
              autoFocus
              placeholder="Two poached eggs on sourdough with avocado and a flat white"
              onChange={(event) => setDescription(event.target.value)}
            />
            <div style={{ height: 14 }} />
            <button
              className="btn primary block"
              disabled={description.trim().length < 3}
              onClick={() => void runAnalysis({ description: description.trim() })}
            >
              Estimate it
            </button>
            <div style={{ height: 10 }} />
            <button className="btn block ghost" onClick={() => setStage("choose")}>
              Back
            </button>
          </>
        )}

        {stage === "scan" && (
          <BarcodeScanner
            onDetected={(code) => void handleBarcode(code)}
            onCancel={() => setStage("choose")}
          />
        )}

        {stage === "product" && product && (
          <>
            {product.imageUrl && (
              <img className="hero-photo" src={product.imageUrl} alt={product.name} />
            )}
            <h3>{product.name}</h3>
            <div className="ring-sub" style={{ marginTop: 2 }}>
              {product.brand && `${product.brand} · `}
              {product.packSize && `${product.packSize} · `}
              label figures from Open Food Facts
            </div>

            <div className="chips" style={{ margin: "16px 0" }}>
              {portionOptions(product).map((option) => (
                <button
                  key={option.label}
                  className="chip"
                  aria-pressed={grams === option.grams}
                  onClick={() => setGrams(option.grams)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="field">
              <label htmlFor="grams">How much did you have? (grams)</label>
              <input
                id="grams"
                type="number"
                inputMode="numeric"
                min={1}
                value={grams}
                onChange={(event) => setGrams(Math.max(0, Number(event.target.value)))}
              />
            </div>

            <div className="card" style={{ padding: 16 }}>
              <div className="ring-value">{macrosForGrams(product, grams).calories} kcal</div>
              <div className="ring-sub" style={{ marginTop: 4 }}>
                P{macrosForGrams(product, grams).protein} · C
                {macrosForGrams(product, grams).carbs} · F
                {macrosForGrams(product, grams).fat} — per 100 g:{" "}
                {product.per100g.calories} kcal
              </div>
            </div>

            <div className="chips" style={{ margin: "16px 0" }}>
              {MEALS.map((option) => (
                <button
                  key={option}
                  className="chip"
                  aria-pressed={meal === option}
                  onClick={() => setMeal(option)}
                >
                  {MEAL_LABELS[option]}
                </button>
              ))}
            </div>

            <div className="row">
              <button
                className="btn ghost"
                onClick={() => setStage("scan")}
                disabled={saving}
              >
                Scan another
              </button>
              <button
                className="btn primary"
                onClick={() => void saveProduct()}
                disabled={saving || grams <= 0}
              >
                {saving ? "Saving…" : `Log ${macrosForGrams(product, grams).calories} kcal`}
              </button>
            </div>
          </>
        )}

        {stage === "analysing" && (
          <div className="analysing">
            {photo && <img className="hero-photo" src={photo} alt="" />}
            <div className="spinner" style={{ color: "var(--text)" }} />
            <div>
              Working out what&apos;s on the plate
              <br />
              and how much of it there is…
            </div>
          </div>
        )}

        {stage === "review" && analysis && (
          <>
            {photo && <img className="hero-photo" src={photo} alt={analysis.title} />}
            <h3>{analysis.title}</h3>
            <div className="ring-sub" style={{ marginTop: 2 }}>
              {Math.round(totals.calories)} kcal · {Math.round(totals.protein)}g protein ·{" "}
              {Math.round(totals.carbs)}g carbs · {Math.round(totals.fat)}g fat
            </div>
            {range && range.high > range.low && (
              <div className="range">
                <span className="range-label">likely {range.low}–{range.high} kcal</span>
                <span className="range-hint">
                  how much a photo can&apos;t pin down for this meal
                </span>
              </div>
            )}

            <div className="chips" style={{ margin: "16px 0" }}>
              {MEALS.map((option) => (
                <button
                  key={option}
                  className="chip"
                  aria-pressed={meal === option}
                  onClick={() => setMeal(option)}
                >
                  {MEAL_LABELS[option]}
                </button>
              ))}
            </div>

            <div className="card" style={{ padding: "4px 16px" }}>
              {drafts.map((item) => {
                const shown = scaled(item);
                return (
                  <div className="item-row" key={item.id}>
                    <div style={{ opacity: item.factor === 0 ? 0.4 : 1 }}>
                      <div className="label">{item.name}</div>
                      <div className="sub">
                        {shown.grams} g · {shown.calories} kcal · P{shown.protein} C
                        {shown.carbs} F{shown.fat}
                      </div>
                      <div className="confidence" style={{ marginTop: 5 }}>
                        <i
                          className="dot"
                          style={{ background: confidenceColour(item.confidence) }}
                        />
                        {confidenceLabel(item.confidence)}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div className="stepper">
                        <button
                          aria-label={`Less ${item.name}`}
                          onClick={() => adjust(item.id, -0.25)}
                          disabled={item.factor <= 0}
                        >
                          −
                        </button>
                        <span>{Math.round(item.factor * 100)}%</span>
                        <button
                          aria-label={`More ${item.name}`}
                          onClick={() => adjust(item.id, 0.25)}
                        >
                          +
                        </button>
                      </div>
                      <button
                        className="btn ghost"
                        style={{ padding: 6, border: "none" }}
                        aria-label={`Remove ${item.name}`}
                        onClick={() => remove(item.id)}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {analysis.notes && (
              <div className="notice info" style={{ marginTop: 14 }}>
                {analysis.notes}
              </div>
            )}

            <div className="field" style={{ marginTop: 14 }}>
              <label htmlFor="correction">
                {analysis.questions.length > 0
                  ? "It would estimate better if it knew:"
                  : "Anything it got wrong?"}
              </label>

              {analysis.questions.length > 0 && (
                <ul className="questions">
                  {analysis.questions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              )}

              <textarea
                id="correction"
                rows={3}
                value={correction}
                placeholder={
                  "10% fat mince, drained the fat off\n800 g raw split 4.5 ways\nfull 420 g tin of corn in the batch"
                }
                onChange={(event) => setCorrection(event.target.value)}
                onKeyDown={(event) => {
                  // Enter sends; Shift+Enter starts a new line, so several
                  // questions can be answered in one go.
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submitCorrection();
                  }
                }}
              />
              <div className="hint">
                Answer as many as you like — Shift+Enter for a new line, Enter to send.
              </div>
              <button
                className="btn block"
                style={{ marginTop: 10 }}
                disabled={correction.trim().length < 2}
                onClick={submitCorrection}
              >
                Update the estimate
              </button>
            </div>

            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn ghost" onClick={onClose} disabled={saving}>
                Discard
              </button>
              <button
                className="btn primary"
                onClick={() => void save()}
                disabled={saving || kept.length === 0}
              >
                {saving ? "Saving…" : `Log ${Math.round(totals.calories)} kcal`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
