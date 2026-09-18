"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/client";
import {
  formatDayMonth,
  loggingStreak,
  shiftDateKey,
  startOfWeek,
  toDateKey,
  totalsForEntries,
} from "@/lib/nutrition";
import type { DayTargets, Entry, WeighIn } from "@/lib/types";

/**
 * The longer view: is this actually working?
 *
 * Two single-series charts rather than one with two scales — weight and
 * calories share no axis, and overlaying them would invent a correlation.
 * The pair that matters most isn't a chart at all: what the food log predicts
 * against what the scales say. That comparison is the only thing that can tell
 * you whether the estimates are any good, so it's stated in words.
 */

const WEEKS = 8;
const KCAL_PER_KG = 7700;
const CHART_HEIGHT = 120;

interface TrendsViewProps {
  entries: Entry[];
  weighIns: WeighIn[];
  targets: DayTargets;
  loggedDates: string[];
  onWeighIn: (weighIns: WeighIn[]) => void;
}

export function TrendsView({
  entries,
  weighIns,
  targets,
  loggedDates,
  onWeighIn,
}: TrendsViewProps) {
  const [weight, setWeight] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredWeek, setHoveredWeek] = useState<string | null>(null);
  const [hoveredWeighIn, setHoveredWeighIn] = useState<number | null>(null);

  const weeks = useMemo(() => {
    const thisMonday = startOfWeek(toDateKey());
    return Array.from({ length: WEEKS }, (_, index) => {
      const start = shiftDateKey(thisMonday, -(WEEKS - 1 - index) * 7);
      const end = shiftDateKey(start, 6);
      const within = entries.filter((e) => e.date >= start && e.date <= end);
      const days = new Set(within.map((e) => e.date)).size;
      const total = totalsForEntries(within).calories;
      return {
        start,
        end,
        days,
        // Average across days actually logged, not across seven — a week with
        // two days logged isn't a week of tiny meals.
        average: days > 0 ? Math.round(total / days) : 0,
        label: formatDayMonth(start),
        // Compact day/month for the axis, where eight labels share 390px.
        short: `${Number(start.slice(8))}/${Number(start.slice(5, 7))}`,
      };
    });
  }, [entries]);

  const sortedWeighIns = useMemo(
    () => [...weighIns].sort((a, b) => a.date.localeCompare(b.date)),
    [weighIns],
  );

  /**
   * What the log says should have happened, against what the scales say did.
   * Only days with meals logged can contribute — an unlogged day is not a day
   * of zero calories, and counting it as one would invent a deficit.
   */
  const reconciliation = useMemo(() => {
    if (sortedWeighIns.length < 2) return null;
    const first = sortedWeighIns[0];
    const last = sortedWeighIns[sortedWeighIns.length - 1];

    const days = [...new Set(entries.map((e) => e.date))].filter(
      (date) => date >= first.date && date <= last.date,
    );
    if (days.length < 7) return null;

    const deficit = days.reduce((sum, date) => {
      const eaten = totalsForEntries(entries.filter((e) => e.date === date)).calories;
      return sum + (targets.calories - eaten);
    }, 0);

    return {
      days: days.length,
      predictedKg: -(deficit / KCAL_PER_KG),
      actualKg: last.weightKg - first.weightKg,
      from: first.date,
      to: last.date,
    };
  }, [entries, sortedWeighIns, targets.calories]);

  async function saveWeight() {
    const value = Number(weight);
    if (!Number.isFinite(value) || value <= 0) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api.weighIn(value);
      onWeighIn(result.weighIns);
      setWeight("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save that.");
    } finally {
      setSaving(false);
    }
  }

  const ceiling = Math.max(targets.calories, ...weeks.map((w) => w.average)) * 1.15;
  const targetY = CHART_HEIGHT - (targets.calories / ceiling) * CHART_HEIGHT;
  const shownWeek = hoveredWeek ? weeks.find((w) => w.start === hoveredWeek) : null;
  const loggedTotal = loggedDates.length;

  // Weight line geometry.
  const weightPoints = sortedWeighIns.slice(-40);
  const weightPath = (() => {
    if (weightPoints.length < 2) return null;
    const values = weightPoints.map((w) => w.weightKg);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const coords = weightPoints.map((point, index) => ({
      x: (index / (weightPoints.length - 1)) * 100,
      y: CHART_HEIGHT - ((point.weightKg - min) / span) * (CHART_HEIGHT - 20) - 10,
      point,
    }));
    return {
      min,
      max,
      coords,
      d: coords
        .map((c, index) => `${index === 0 ? "M" : "L"}${c.x.toFixed(2)},${c.y.toFixed(2)}`)
        .join(" "),
    };
  })();

  const shownWeighIn =
    hoveredWeighIn !== null ? weightPoints[hoveredWeighIn] : undefined;

  const dayMonth = formatDayMonth;

  return (
    <>
      <div className="macro-grid" style={{ marginTop: 0 }}>
        <div className="macro">
          <div className="name">Streak</div>
          <div className="value">{loggingStreak(loggedDates)}</div>
          <div className="chart-sub">days running</div>
        </div>
        <div className="macro">
          <div className="name">Logged</div>
          <div className="value">{loggedTotal}</div>
          <div className="chart-sub">days all up</div>
        </div>
        <div className="macro">
          <div className="name">Weight</div>
          <div className="value">
            {sortedWeighIns.length > 0
              ? sortedWeighIns[sortedWeighIns.length - 1].weightKg
              : "—"}
          </div>
          <div className="chart-sub">kg, latest</div>
        </div>
      </div>

      <section className="card">
        <div className="chart-head">
          <div>
            <div className="chart-title">Average daily calories, by week</div>
            <div className="chart-sub">
              {shownWeek
                ? `Week of ${shownWeek.label} — ${
                    shownWeek.days > 0
                      ? `${shownWeek.average} kcal across ${shownWeek.days} logged ${
                          shownWeek.days === 1 ? "day" : "days"
                        }`
                      : "nothing logged"
                  }`
                : `Target ${targets.calories} kcal a day`}
            </div>
          </div>
        </div>

        <div className="chart" style={{ height: CHART_HEIGHT }}>
          <svg
            viewBox={`0 0 100 ${CHART_HEIGHT}`}
            preserveAspectRatio="none"
            className="chart-svg"
            role="img"
            aria-label="Average daily calories for each of the last eight weeks"
          >
            <line
              x1="0"
              x2="100"
              y1={targetY}
              y2={targetY}
              className="chart-target"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <div className="chart-bars">
            {weeks.map((week) => (
              <button
                key={week.start}
                className="chart-bar"
                aria-label={`Week of ${week.label}: ${week.average} kilocalories average`}
                onMouseEnter={() => setHoveredWeek(week.start)}
                onMouseLeave={() => setHoveredWeek(null)}
                onFocus={() => setHoveredWeek(week.start)}
                onBlur={() => setHoveredWeek(null)}
              >
                <span
                  className="chart-bar-fill"
                  style={{
                    height: Math.max(
                      week.average > 0 ? 3 : 0,
                      (week.average / ceiling) * CHART_HEIGHT,
                    ),
                    opacity: week.start === hoveredWeek ? 1 : 0.85,
                  }}
                />
              </button>
            ))}
          </div>
        </div>
        <div className="chart-axis">
          {weeks.map((week) => (
            <span key={week.start}>{week.short}</span>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="chart-head">
          <div>
            <div className="chart-title">Weight</div>
            <div className="chart-sub">
              {shownWeighIn
                ? `${dayMonth(shownWeighIn.date)} — ${shownWeighIn.weightKg} kg`
                : weightPath
                  ? `${weightPath.min} – ${weightPath.max} kg over ${weightPoints.length} weigh-ins`
                  : "Two weigh-ins and this starts drawing."}
            </div>
          </div>
        </div>

        {weightPath && (
          <>
            <div className="chart" style={{ height: CHART_HEIGHT }}>
              <svg
                viewBox={`0 0 100 ${CHART_HEIGHT}`}
                preserveAspectRatio="none"
                className="chart-svg"
                role="img"
                aria-label="Weight over time"
              >
                <path d={weightPath.d} className="chart-line" vectorEffect="non-scaling-stroke" />
                {weightPath.coords.map((coord, index) => {
                  const active =
                    index === hoveredWeighIn || (hoveredWeighIn === null && index === weightPath.coords.length - 1);
                  if (!active) return null;
                  return (
                    <circle
                      key={coord.point.date}
                      cx={coord.x}
                      cy={coord.y}
                      r="4"
                      className="chart-dot"
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}
              </svg>

              {/* Hit areas sized for a fingertip rather than for the marks. */}
              <div className="chart-bars">
                {weightPoints.map((point, index) => (
                  <button
                    key={point.date}
                    className="chart-bar"
                    aria-label={`${dayMonth(point.date)}: ${point.weightKg} kilograms`}
                    onMouseEnter={() => setHoveredWeighIn(index)}
                    onMouseLeave={() => setHoveredWeighIn(null)}
                    onFocus={() => setHoveredWeighIn(index)}
                    onBlur={() => setHoveredWeighIn(null)}
                  />
                ))}
              </div>
            </div>
            <div className="chart-axis" style={{ justifyContent: "space-between" }}>
              <span style={{ flex: "0 0 auto" }}>{dayMonth(weightPoints[0].date)}</span>
              <span style={{ flex: "0 0 auto" }}>
                {dayMonth(weightPoints[weightPoints.length - 1].date)}
              </span>
            </div>
          </>
        )}

        {error && (
          <div className="notice error" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}

        <div className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="weighin">Today&apos;s weight (kg)</label>
            <input
              id="weighin"
              type="number"
              inputMode="decimal"
              step="0.1"
              value={weight}
              onChange={(event) => setWeight(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveWeight();
              }}
            />
          </div>
          <button
            className="btn"
            style={{ flex: "0 0 auto" }}
            disabled={saving || weight.trim() === ""}
            onClick={() => void saveWeight()}
          >
            {saving ? "Saving…" : "Record"}
          </button>
        </div>
      </section>

      {reconciliation && (
        <section className="card">
          <div className="chart-title">Does the log agree with the scales?</div>
          <div className="reconcile">
            <div>
              <span className="reconcile-value">
                {reconciliation.predictedKg >= 0 ? "+" : ""}
                {reconciliation.predictedKg.toFixed(1)} kg
              </span>
              <span className="reconcile-label">what the food log predicts</span>
            </div>
            <div>
              <span className="reconcile-value">
                {reconciliation.actualKg >= 0 ? "+" : ""}
                {reconciliation.actualKg.toFixed(1)} kg
              </span>
              <span className="reconcile-label">what the scales say</span>
            </div>
          </div>
          <div className="chart-sub" style={{ marginTop: 10, lineHeight: 1.6 }}>
            Across {reconciliation.days} logged days. If these two disagree
            consistently, the estimates are leaning — the scales are the ones telling
            the truth. Unlogged days aren&apos;t counted, so a patchy fortnight will
            make the prediction look smaller than it was.
          </div>
        </section>
      )}
    </>
  );
}
