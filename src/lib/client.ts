import type { Analysis } from "./analyse";
import type { DayTargets, Entry, Product, Profile, UserSummary, WeighIn } from "./types";

/**
 * Browser-side API wrapper. Every call carries the selected profile, so the two
 * people sharing a deployment never see each other's log.
 */

const USER_KEY = "kilo_user";

export function currentUser(): string {
  if (typeof window === "undefined") return "one";
  try {
    return window.localStorage.getItem(USER_KEY) ?? "one";
  } catch {
    // Private browsing can throw on access; fall back to the first profile.
    return "one";
  }
}

export function setCurrentUser(id: string): void {
  try {
    window.localStorage.setItem(USER_KEY, id);
  } catch {
    // Not fatal — the cookie below still carries the choice for this session.
  }
  // Mirrored into a cookie so server routes can read it without a query param.
  document.cookie = `kilo_user=${id}; path=/; max-age=31536000; samesite=lax`;
}

/** Append the active profile to a URL. */
function withUser(url: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}user=${encodeURIComponent(currentUser())}`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string" ? payload.error : "Something went wrong.",
    );
  }
  return payload as T;
}

/** Where a stored photo is served from. */
export function photoUrl(name: string): string {
  return `/api/photos/${encodeURIComponent(name)}`;
}

export const api = {
  users: () => request<{ users: UserSummary[] }>("/api/users"),

  profile: () =>
    request<{
      userId: string;
      profile: Profile | null;
      targets: DayTargets | null;
      weighIns: WeighIn[];
    }>(withUser("/api/profile")),

  saveProfile: (profile: Partial<Profile>) =>
    request<{ profile: Profile; targets: DayTargets }>(withUser("/api/profile"), {
      method: "POST",
      body: JSON.stringify(profile),
    }),

  weighIn: (weightKg: number) =>
    request<{ weighIns: WeighIn[]; targets: DayTargets | null }>(withUser("/api/profile"), {
      method: "PUT",
      body: JSON.stringify({ weightKg }),
    }),

  entries: (date?: string) =>
    request<{ entries: Entry[] }>(withUser(`/api/entries${date ? `?date=${date}` : ""}`)),

  createEntry: (entry: Partial<Entry>) =>
    request<{ entry: Entry }>(withUser("/api/entries"), {
      method: "POST",
      body: JSON.stringify(entry),
    }),

  updateEntry: (id: string, patch: Partial<Entry>) =>
    request<{ entry: Entry }>(withUser("/api/entries"), {
      method: "PATCH",
      body: JSON.stringify({ id, ...patch }),
    }),

  deleteEntry: (id: string) =>
    request<{ ok: true }>(withUser(`/api/entries?id=${encodeURIComponent(id)}`), {
      method: "DELETE",
    }),

  analyse: (input: { image?: string; description?: string }) =>
    request<{ analysis: Analysis }>("/api/analyse", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  barcode: (code: string) =>
    request<{ product: Product }>(`/api/barcode?code=${encodeURIComponent(code)}`),
};
