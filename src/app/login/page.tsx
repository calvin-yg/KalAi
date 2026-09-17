"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const router = useRouter();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode }),
    });
    if (response.ok) {
      router.replace("/");
      router.refresh();
      return;
    }
    setError("That passcode isn't right.");
    setBusy(false);
  }

  return (
    <main className="gate">
      <div className="brand" style={{ justifyContent: "center", marginBottom: 20 }}>
        Kilo <span>photo tracking</span>
      </div>
      <form onSubmit={submit}>
        {error && <div className="notice error">{error}</div>}
        <div className="field">
          <label htmlFor="passcode">Passcode</label>
          <input
            id="passcode"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
          />
        </div>
        <button className="btn primary block" type="submit" disabled={busy || !passcode}>
          {busy ? "Checking…" : "Unlock"}
        </button>
      </form>
    </main>
  );
}
