"use client";

import { useMemo, useState } from "react";
import {
  formatDateKey,
  toDateKey,
  totalsForEntries,
  weekDaysFor,
  weekdayLabel,
} from "@/lib/nutrition";
import type { DayTargets, Entry } from "@/lib/types";

/**
 * One week at a glance.
 *
 * The job is magnitude against a limit, so it's a single-hue column chart with
 * the target drawn as a reference line — not seven colours, and not a value
 * ramp that would encode bar height twice. Over and under are read off the
 * line rather than from colour, which keeps the chart honest for anyone who
 * can't distinguish the hues.
 */

interface WeekViewProps {
  date: string;
  entries: Entry[];
  targets: DayTargets;
  onPickDay: (date: string) => void;
}

const CHART_HEIGHT = 150;

export function WeekView({ date, entries, targets, onPickDay }: WeekViewProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  const days = useMemo(() => {
    const today = toDateKey();
    return weekDaysFor(date).map((key) => {
      const dayEntries = entries.filter((entry) => entry.date === key);
      return {
        key,
        label: weekdayLabel(key),
        totals: totalsForEntries(dayEntries),
        meals: dayEntries.length,
        future: key > today,
      };
    });
  }, [entries, date]);

  const logged = days.filter((day) => day.meals > 0);
  const past = days.filter((day) => !day.future);

  const averages = useMemo(() => {
    if (logged.length === 0) return null;
    const sum = logged.reduce(
      (acc, day) => ({
        calories: acc.calories + day.totals.calories,
        protein: acc.protein + day.totals.protein,
        carbs: acc.carbs + day.totals.carbs,
        fat: acc.fat + day.totals.fat,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    );
    return {
      calories: Math.round(sum.calories / logged.length),
      protein: Math.round(sum.protein / logged.length),
      carbs: Math.round(sum.carbs / logged.length),
      fat: Math.round(sum.fat / logged.length),
    };
  }, [logged]);

  // Headroom above whichever is taller, so the target line is never at the edge.
  const ceiling = Math.max(targets.calories, ...days.map((d) => d.totals.calories)) * 1.15;
  const targetY = CHART_HEIGHT - (targets.calories / ceiling) * CHART_HEIGHT;
  const onTarget = logged.filter((day) => day.totals.calories <= targets.calories).length;

  const shown = hovered ? days.find((day) => day.key === hovered) : null;

  return (
    <>
      <section className="card">
        <div className="chart-head">
          <div>
            <div className="chart-title">Daily calories</div>
            <div className="chart-sub">
              {shown
                ? `${formatDateKey(shown.key)} — ${shown.totals.calories} kcal${
                    shown.meals === 0 ? " (nothing logged)" : ""
                  }`
                : `Target ${targets.calories} kcal a day`}
            </div>
          </div>
          {averages && (
            <div className="chart-figure">
              <span>{averages.calories}</span>
              <small>avg / day</small>
            </div>
          )}
        </div>

        <div className="chart" style={{ height: CHART_HEIGHT }}>
          <svg
            viewBox={`0 0 100 ${CHART_HEIGHT}`}
            preserveAspectRatio="none"
            className="chart-svg"
            role="img"
            aria-label={`Calories for each day of the week beginning ${days[0].key}`}
          >
            {/* The limit being measured against. */}
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
            {days.map((day) => {
              const height = Math.max(
                day.totals.calories > 0 ? 3 : 0,
                (day.totals.calories / ceiling) * CHART_HEIGHT,
              );
              return (
                <button
                  key={day.key}
                  className="chart-bar"
                  aria-label={`${day.label}: ${day.totals.calories} kilocalories`}
                  onMouseEnter={() => setHovered(day.key)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(day.key)}
                  onBlur={() => setHovered(null)}
                  onClick={() => onPickDay(day.key)}
                >
                  <span
                    className="chart-bar-fill"
                    style={{
                      height,
                      opacity: day.future ? 0.25 : day.key === hovered ? 1 : 0.85,
                    }}
                  />
                </button>
              );
            })}
          </div>
        </div>

        <div className="chart-axis">
          {days.map((day) => (
            <span key={day.key} className={day.key === date ? "current" : undefined}>
              {day.label}
            </span>
          ))}
        </div>
      </section>

      <div className="macro-grid">
        <div className="macro">
          <div className="name">Logged</div>
          <div className="value">
            {logged.length}
            <span style={{ fontSize: 12, color: "var(--muted)" }}>/{past.length}</span>
          </div>
          <div className="chart-sub">days this week</div>
        </div>
        <div className="macro">
          <div className="name">On target</div>
          <div className="value">{onTarget}</div>
          <div className="chart-sub">
            {onTarget === 1 ? "day at or under" : "days at or under"}
          </div>
        </div>
        <div className="macro">
          <div className="name" style={{ color: "var(--protein)" }}>
            Protein
          </div>
          <div className="value">{averages ? `${averages.protein}` : "—"}</div>
          <div className="chart-sub">avg g, target {targets.protein}</div>
        </div>
      </div>

      {logged.length === 0 && (
        <div className="empty" style={{ marginTop: 14 }}>
          Nothing logged this week yet.
        </div>
      )}
    </>
  );
}
