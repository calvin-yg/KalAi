/**
 * Optional shared passcode for the whole deployment.
 *
 * This is a front door, not per-user auth: the two people sharing it use the
 * same code, and the profile switcher is a convenience, not a security boundary.
 * It exists so that a personal tracker on a public URL isn't readable and
 * writable by anyone who guesses the address.
 *
 * Set KILO_PASSCODE to turn it on. Left unset (e.g. on localhost), the app is open.
 */

export const GATE_COOKIE = "kilo_gate";

/** Web Crypto rather than node:crypto, so middleware can use this too. */
export async function passcodeToken(passcode: string): Promise<string> {
  const data = new TextEncoder().encode(`kilo:${passcode}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function configuredPasscode(): string | null {
  const value = process.env.KILO_PASSCODE?.trim();
  return value ? value : null;
}
