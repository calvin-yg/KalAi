"use client";

import { useState } from "react";
import { api, photoUrl } from "@/lib/client";
import { toKilojoules } from "@/lib/nutrition";
import type { Entry } from "@/lib/types";

interface EntrySheetProps {
  entry: Entry;
  onClose: () => void;
  onDeleted: (id: string) => void;
}

export function EntrySheet({ entry, onClose, onDeleted }: EntrySheetProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteEntry(entry.id);
      onDeleted(entry.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete that.");
      setBusy(false);
    }
  }

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={entry.title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet">
        <div className="grabber" />
        {error && <div className="notice error">{error}</div>}
        {entry.photo && (
          <img className="hero-photo" src={photoUrl(entry.photo)} alt={entry.title} />
        )}
        <h3>{entry.title}</h3>
        <div className="ring-sub" style={{ marginTop: 2 }}>
          {entry.totals.calories} kcal ({toKilojoules(entry.totals.calories)} kJ) ·{" "}
          {entry.source === "barcode"
            ? "from the product label"
            : `nutrition score ${entry.healthScore}/10`}
          {entry.edited ? " · portions adjusted" : ""}
        </div>

        {entry.range && entry.range.high > entry.range.low && (
          <div className="range">
            <span className="range-label">
              likely {entry.range.low}–{entry.range.high} kcal
            </span>
            <span className="range-hint">estimated from the photo, not measured</span>
          </div>
        )}

        <div className="macro-grid">
          {(
            [
              ["Protein", entry.totals.protein, "var(--protein)"],
              ["Carbs", entry.totals.carbs, "var(--carbs)"],
              ["Fat", entry.totals.fat, "var(--fat)"],
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

        <div className="card" style={{ padding: "4px 16px", marginTop: 14 }}>
          {entry.items.map((item) => (
            <div className="item-row" key={item.id}>
              <div>
                <div className="label">{item.name}</div>
                <div className="sub">
                  {item.quantity} {item.unit} · {item.grams} g · P{item.protein} C
                  {item.carbs} F{item.fat}
                </div>
              </div>
              <div style={{ fontWeight: 700 }}>{item.calories}</div>
            </div>
          ))}
        </div>

        {entry.notes && (
          <div className="notice info" style={{ marginTop: 14 }}>
            {entry.notes}
          </div>
        )}

        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button
            className="btn"
            style={{ color: "var(--warn)" }}
            onClick={() => void remove()}
            disabled={busy}
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
