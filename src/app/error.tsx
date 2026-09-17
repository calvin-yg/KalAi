"use client";

import { useEffect } from "react";

/**
 * Last line of defence. Without this a render-time crash leaves a blank white
 * screen with no way back — the worst possible outcome on a phone mid-meal.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled error", error);
  }, [error]);

  return (
    <main className="app">
      <div className="notice error" style={{ marginTop: 40 }}>
        Something went wrong displaying this page. Your logged meals are safe.
      </div>
      <button className="btn primary block" onClick={reset}>
        Try again
      </button>
      <div style={{ height: 10 }} />
      <a className="btn block ghost" href="/" style={{ textDecoration: "none" }}>
        Back to today
      </a>
    </main>
  );
}
