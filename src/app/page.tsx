"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CaptureSheet } from "@/components/CaptureSheet";
import { EntrySheet } from "@/components/EntrySheet";
import { Ring } from "@/components/Ring";
import { TrendsView } from "@/components/TrendsView";
import { WeekView } from "@/components/WeekView";
import { api, currentUser, photoUrl, setCurrentUser } from "@/lib/client";
import {
  formatDateKey,
  loggingStreak,
  shiftDateKey,
  toDateKey,
  toKilojoules,
  totalsForEntries,
  weekDaysFor,
  weekdayLabel,
} from "@/lib/nutrition";
import type { DayTargets, Entry, Profile, UserSummary, WeighIn } from "@/lib/types";

type View = "day" | "week" | "trends";

/** How much history the dashboard pulls around the selected day. */
const WINDOW_DAYS = 30;

/** Trends looks back eight weeks, so it needs a wider net than a single week. */
const TRENDS_DAYS = 70;

/**
 * What to fetch for a given day: enough history for browsing, and out to the
 * end of that day's week so the strip isn't missing days that do have meals.
 */
function rangeFor(date: string, view: View): { from: string; to: string } {
  const today = toDateKey();
  if (view === "trends") {
    return { from: shiftDateKey(today, -TRENDS_DAYS), to: today };
  }
  const days = weekDaysFor(date);
  const weekEnd = days[6];
  return {
    from: shiftDateKey(days[0], -WINDOW_DAYS),
    to: weekEnd > today ? today : weekEnd,
  };
}

const MEAL_ICONS: Record<Entry["meal"], string> = {
  breakfast: "🍳",
  lunch: "🥗",
  dinner: "🍽",
  snack: "🍎",
};

export default function Home() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [targets, setTargets] = useState<DayTargets | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [date, setDate] = useState(() => toDateKey());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loggedDates, setLoggedDates] = useState<string[]>([]);
  const [weighIns, setWeighIns] = useState<WeighIn[]>([]);
  const [view, setView] = useState<View>("day");
  /** The date range currently held in `entries`, so we only refetch on leaving it. */
  const [loadedRange, setLoadedRange] = useState<{ from: string; to: string } | null>(null);
  const [userId, setUserId] = useState("one");
  const [capturing, setCapturing] = useState(false);
  const [viewing, setViewing] = useState<Entry | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    setUserId(currentUser());
    try {
      const range = rangeFor(date, view);
      const [profileResult, entriesResult, usersResult] = await Promise.all([
        api.profile(),
        api.entries(range),
        api.users(),
      ]);
      setUsers(usersResult.users);
      if (!profileResult.profile) {
        router.replace("/onboarding");
        return;
      }
      setProfile(profileResult.profile);
      setTargets(profileResult.targets);
      setEntries(entriesResult.entries);
      setLoggedDates(entriesResult.loggedDates);
      setWeighIns(profileResult.weighIns);
      setLoadedRange(range);
      setLoading(false);
    } catch (caught) {
      // Without this the screen would sit on the spinner indefinitely.
      setLoadError(
        caught instanceof Error ? caught.message : "Could not load your day.",
      );
      setLoading(false);
    }
  }, [router, date, view]);

  /**
   * Paging through days stays local until it leaves the loaded window — a tap
   * on the arrow shouldn't cost a round trip when the data is already here.
   */
  useEffect(() => {
    const range = rangeFor(date, view);
    if (
      loadedRange &&
      range.from >= loadedRange.from &&
      range.to <= loadedRange.to &&
      date >= loadedRange.from &&
      date <= loadedRange.to
    ) {
      return;
    }
    let cancelled = false;
    void api
      .entries(range)
      .then((result) => {
        if (cancelled) return;
        setEntries(result.entries);
        setLoggedDates(result.loggedDates);
        setLoadedRange(range);
      })
      .catch(() => {
        // Keep showing what we have; the day just won't fill in.
      });
    return () => {
      cancelled = true;
    };
  }, [date, view, loadedRange]);

  useEffect(() => {
    void load();
    // Only on mount and on profile switch; day paging is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  function switchTo(id: string) {
    setCurrentUser(id);
    setUserId(id);
    setLoading(true);
    void load();
  }

  const dayEntries = useMemo(
    () => entries.filter((entry) => entry.date === date),
    [entries, date],
  );
  const eaten = useMemo(() => totalsForEntries(dayEntries), [dayEntries]);
  const streak = useMemo(() => loggingStreak(loggedDates), [loggedDates]);

  const week = useMemo(
    () =>
      weekDaysFor(date).map((key) => ({
        key,
        calories: totalsForEntries(entries.filter((e) => e.date === key)).calories,
        // Days that haven't happened yet are drawn faintly rather than as empty ones.
        future: key > toDateKey(),
      })),
    [entries, date],
  );

  if (loadError) {
    return (
      <main className="app">
        <div className="notice error" style={{ marginTop: 40 }}>
          {loadError}
        </div>
        <button
          className="btn primary block"
          onClick={() => {
            setLoading(true);
            void load();
          }}
        >
          Try again
        </button>
      </main>
    );
  }

  if (loading || !profile || !targets) {
    return (
      <main className="app">
        <div className="analysing">
          <div className="spinner" style={{ color: "var(--text)" }} />
          Loading your day…
        </div>
      </main>
    );
  }

  const remaining = targets.calories - eaten.calories;
  const isToday = date === toDateKey();

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          Kilo <span>photo tracking</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <span className="streak" title="Consecutive days logged">
            🔥 {streak}
          </span>
          <Link className="streak" href="/onboarding" style={{ textDecoration: "none" }}>
            ⚙️
          </Link>
        </div>
      </header>

      {users.length > 1 && (
        <div className="tabs">
          {users.map((user) => (
            <button
              key={user.id}
              aria-selected={user.id === userId}
              onClick={() => switchTo(user.id)}
            >
              {user.name}
            </button>
          ))}
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="View">
        {(["day", "week", "trends"] as View[]).map((option) => (
          <button
            key={option}
            role="tab"
            aria-selected={view === option}
            onClick={() => setView(option)}
          >
            {option === "day" ? "Day" : option === "week" ? "Week" : "Trends"}
          </button>
        ))}
      </div>

      {view !== "trends" && (
        <div className="daynav">
          <button
            aria-label={view === "week" ? "Previous week" : "Previous day"}
            onClick={() => setDate(shiftDateKey(date, view === "week" ? -7 : -1))}
          >
            ‹
          </button>
          <h2>
            {view === "week"
              ? `Week of ${formatDateKey(weekDaysFor(date)[0])}`
              : formatDateKey(date)}
          </h2>
          <button
            aria-label={view === "week" ? "Next week" : "Next day"}
            disabled={view === "week" ? weekDaysFor(date)[6] >= toDateKey() : isToday}
            onClick={() => setDate(shiftDateKey(date, view === "week" ? 7 : 1))}
          >
            ›
          </button>
        </div>
      )}

      {view === "day" && (
        <>
        <section className="card">
          <div className="ring-hero">
            <div className="figure">
              <Ring progress={eaten.calories / targets.calories}>
                <div className="ring-value">{Math.abs(Math.round(remaining))}</div>
                <div className="ring-label">{remaining >= 0 ? "left" : "over"}</div>
              </Ring>
            </div>
            <div>
              <div className="ring-value">{eaten.calories}</div>
              <div className="ring-label">
                of {targets.calories} kcal · {toKilojoules(eaten.calories)} kJ
              </div>
              <div className="ring-sub">
                {profile.goal === "maintain"
                  ? `Maintenance for you is about ${targets.maintenance} kcal a day.`
                  : profile.goal === "lose"
                    ? `A ${targets.maintenance - targets.calories} kcal daily deficit — about ${profile.rateKgPerWeek} kg a week.`
                    : `A ${targets.calories - targets.maintenance} kcal daily surplus — about ${profile.rateKgPerWeek} kg a week.`}
              </div>
            </div>
          </div>

          <div className="macro-grid">
            {(
              [
                ["Protein", eaten.protein, targets.protein, "var(--protein)"],
                ["Carbs", eaten.carbs, targets.carbs, "var(--carbs)"],
                ["Fat", eaten.fat, targets.fat, "var(--fat)"],
              ] as const
            ).map(([name, value, target, colour]) => (
              <div className="macro" key={name}>
                <div className="name" style={{ color: colour }}>
                  {name}
                </div>
                <div className="value">
                  {value}
                  <span style={{ fontSize: 12, color: "var(--muted)" }}> /{target} g</span>
                </div>
                <div className="bar">
                  <i
                    style={{
                      width: `${Math.min(100, (value / Math.max(1, target)) * 100)}%`,
                      background: colour,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="weekstrip">
            {week.map((day) => (
              <div
                className="weekday"
                key={day.key}
                style={day.future ? { opacity: 0.35 } : undefined}
              >
                <div className="dotbar">
                  <i
                    style={{
                      height: `${Math.min(100, (day.calories / Math.max(1, targets.calories)) * 100)}%`,
                      opacity: day.key === date ? 1 : 0.4,
                    }}
                  />
                </div>
                {weekdayLabel(day.key)}
              </div>
            ))}
          </div>
        </section>

        <div className="section-title">
          <span>Logged</span>
          <span>{dayEntries.length} {dayEntries.length === 1 ? "meal" : "meals"}</span>
        </div>

        {dayEntries.length === 0 ? (
          <div className="empty">
            Nothing logged {isToday ? "yet today" : "on this day"}.
            <br />
            Tap the camera below and photograph your plate.
          </div>
        ) : (
          dayEntries.map((entry) => (
            <button className="entry" key={entry.id} onClick={() => setViewing(entry)}>
              {entry.photo ? (
                <img className="thumb" src={photoUrl(entry.photo)} alt="" />
              ) : (
                <div className="thumb placeholder">{MEAL_ICONS[entry.meal]}</div>
              )}
              <div className="body">
                <div className="name">{entry.title}</div>
                <div className="meta">
                  {MEAL_ICONS[entry.meal]} P{entry.totals.protein} · C{entry.totals.carbs} · F
                  {entry.totals.fat} ·{" "}
                  {entry.source === "barcode"
                    ? "from the label"
                    : `score ${entry.healthScore}/10`}
                </div>
              </div>
              <div className="kcal">{entry.totals.calories}</div>
            </button>
          ))
        )}
        </>
      )}

      {view === "week" && (
        <WeekView
          date={date}
          entries={entries}
          targets={targets}
          onPickDay={(picked) => {
            setDate(picked);
            setView("day");
          }}
        />
      )}

      {view === "trends" && (
        <TrendsView
          entries={entries}
          weighIns={weighIns}
          targets={targets}
          loggedDates={loggedDates}
          onWeighIn={(updated) => setWeighIns(updated)}
        />
      )}

      <nav className="dock">
        <button className="btn primary" onClick={() => setCapturing(true)}>
          📷 Log a meal
        </button>
      </nav>

      {capturing && (
        <CaptureSheet
          date={date}
          onClose={() => setCapturing(false)}
          onSaved={(entry) => {
            setEntries((current) => [entry, ...current]);
            setLoggedDates((current) =>
              current.includes(entry.date) ? current : [...current, entry.date],
            );
            setCapturing(false);
          }}
        />
      )}

      {viewing && (
        <EntrySheet
          entry={viewing}
          onClose={() => setViewing(null)}
          onDeleted={(id) => {
            setEntries((current) => current.filter((entry) => entry.id !== id));
            setViewing(null);
          }}
        />
      )}
    </main>
  );
}
