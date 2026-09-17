"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, currentUser, setCurrentUser } from "@/lib/client";
import {
  ACTIVITY_LABELS,
  GOAL_LABELS,
  dailyTargets,
  toKilojoules,
} from "@/lib/nutrition";
import type { ActivityLevel, GoalType, Profile, Sex, UserSummary } from "@/lib/types";

const THIS_YEAR = new Date().getFullYear();

const DEFAULTS: Profile = {
  name: "",
  sex: "female",
  birthYear: THIS_YEAR - 35,
  heightCm: 170,
  weightKg: 70,
  activity: "light",
  goal: "lose",
  rateKgPerWeek: 0.5,
  customCalories: null,
  createdAt: new Date().toISOString(),
};

export default function Onboarding() {
  const router = useRouter();
  const [form, setForm] = useState<Profile>(DEFAULTS);
  const [existing, setExisting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [userId, setUserId] = useState("one");

  const loadProfile = useCallback(() => {
    setLoading(true);
    setUserId(currentUser());
    void Promise.all([api.profile(), api.users()])
      .then(([result, usersResult]) => {
        setUsers(usersResult.users);
        if (result.profile) {
          setForm(result.profile);
          setExisting(true);
        } else {
          setForm(DEFAULTS);
          setExisting(false);
        }
      })
      .catch((caught: unknown) => {
        // Fall through to the blank form rather than stalling on the spinner.
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not load your saved details.",
        );
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  /** Swap to the household's other profile slot, creating it if it's empty. */
  function switchSlot(id: string) {
    setCurrentUser(id);
    loadProfile();
  }

  function set<K extends keyof Profile>(key: K, value: Profile[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  // Preview the targets live, so the numbers react as the form is filled in.
  const targets = dailyTargets(form);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.saveProfile(form);
      router.push("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save that.");
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="app">
        <div className="analysing">
          <div className="spinner" style={{ color: "var(--text)" }} />
          Loading…
        </div>
      </main>
    );
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          Kilo <span>{existing ? "your details" : "set up"}</span>
        </div>
      </header>

      {error && <div className="notice error">{error}</div>}

      <div className="tabs">
        {(["one", "two"] as const).map((slot) => {
          const owner = users.find((user) => user.id === slot);
          return (
            <button
              key={slot}
              aria-selected={slot === userId}
              onClick={() => switchSlot(slot)}
            >
              {owner ? owner.name : slot === "one" ? "First profile" : "Add a second"}
            </button>
          );
        })}
      </div>

      {!existing && (
        <div className="notice info">
          These details set the daily calorie and macro targets for this profile. Two
          people can share one deployment — each keeps a separate food log, and you swap
          between them with the tabs above.
        </div>
      )}

      <section className="card">
        <div className="field">
          <label htmlFor="name">First name</label>
          <input
            id="name"
            type="text"
            value={form.name}
            placeholder="Optional"
            onChange={(event) => set("name", event.target.value)}
          />
        </div>

        <div className="field">
          <label>Sex assigned at birth</label>
          <div className="chips">
            {(["female", "male"] as Sex[]).map((option) => (
              <button
                key={option}
                className="chip"
                aria-pressed={form.sex === option}
                onClick={() => set("sex", option)}
              >
                {option === "female" ? "Female" : "Male"}
              </button>
            ))}
          </div>
          <div className="hint">
            Used only for the metabolic-rate formula, which is calibrated separately for
            each.
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="year">Year of birth</label>
            <input
              id="year"
              type="number"
              inputMode="numeric"
              min={THIS_YEAR - 100}
              max={THIS_YEAR - 12}
              value={form.birthYear}
              onChange={(event) => set("birthYear", Number(event.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="height">Height (cm)</label>
            <input
              id="height"
              type="number"
              inputMode="numeric"
              value={form.heightCm}
              onChange={(event) => set("heightCm", Number(event.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="weight">Weight (kg)</label>
            <input
              id="weight"
              type="number"
              inputMode="decimal"
              step="0.1"
              value={form.weightKg}
              onChange={(event) => set("weightKg", Number(event.target.value))}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="activity">How active are you?</label>
          <select
            id="activity"
            value={form.activity}
            onChange={(event) => set("activity", event.target.value as ActivityLevel)}
          >
            {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((level) => (
              <option key={level} value={level}>
                {ACTIVITY_LABELS[level]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Your goal</label>
          <div className="chips">
            {(Object.keys(GOAL_LABELS) as GoalType[]).map((goal) => (
              <button
                key={goal}
                className="chip"
                aria-pressed={form.goal === goal}
                onClick={() => set("goal", goal)}
              >
                {GOAL_LABELS[goal]}
              </button>
            ))}
          </div>
        </div>

        {form.goal !== "maintain" && (
          <div className="field">
            <label htmlFor="rate">
              Pace — {form.rateKgPerWeek} kg per week
            </label>
            <input
              id="rate"
              type="range"
              min="0.1"
              max="1"
              step="0.1"
              value={form.rateKgPerWeek}
              onChange={(event) => set("rateKgPerWeek", Number(event.target.value))}
            />
            <div className="hint">
              0.5 kg a week is the usual sustainable pace. Faster than 1 kg a week is hard
              to hold and costs you muscle.
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor="custom">Override the daily calorie target</label>
          <input
            id="custom"
            type="number"
            inputMode="numeric"
            placeholder={`Calculated: ${targets.calories} kcal`}
            value={form.customCalories ?? ""}
            onChange={(event) =>
              set("customCalories", event.target.value === "" ? null : Number(event.target.value))
            }
          />
          <div className="hint">
            Leave blank unless you have a reason. This is also where a safety margin
            belongs: photo estimates carry real uncertainty, so if you&apos;d rather err on
            the cautious side, set a target a little under the calculated one. Better to
            adjust the goalposts than to have the food log quietly tell you something
            other than what you ate.
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-title" style={{ margin: "0 0 12px" }}>
          <span>Your daily targets</span>
        </div>
        <div className="ring-value">
          {targets.calories} kcal
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--muted)" }}>
            {" "}
            · {toKilojoules(targets.calories)} kJ
          </span>
        </div>
        <div className="ring-sub" style={{ marginTop: 6 }}>
          Resting metabolic rate {targets.bmr} kcal · maintenance {targets.maintenance} kcal
        </div>
        <div className="macro-grid">
          {(
            [
              ["Protein", targets.protein, "var(--protein)"],
              ["Carbs", targets.carbs, "var(--carbs)"],
              ["Fat", targets.fat, "var(--fat)"],
            ] as const
          ).map(([name, value, colour]) => (
            <div className="macro" key={name}>
              <div className="name" style={{ color: colour }}>
                {name}
              </div>
              <div className="value">{value} g</div>
            </div>
          ))}
        </div>
      </section>

      <div className="dock">
        {existing && (
          <button className="btn" onClick={() => router.push("/")} disabled={saving}>
            Cancel
          </button>
        )}
        <button className="btn primary" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : existing ? "Save changes" : "Start tracking"}
        </button>
      </div>
    </main>
  );
}
