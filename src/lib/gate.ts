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

/**
 * Compare without leaking length or content through timing.
 *
 * Both sides are hashed first, so the comparison always runs over two equal
 * fixed-length strings and an attacker learns nothing from how long it took.
 */
export async function passcodeMatches(
  presented: string,
  expected: string,
): Promise<boolean> {
  const [a, b] = await Promise.all([
    passcodeToken(presented),
    passcodeToken(expected),
  ]);

  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

/** Compare an already-hashed cookie value against the expected token. */
export function tokenMatches(presented: string, expected: string): boolean {
  if (presented.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < presented.length; i += 1) {
    difference |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return difference === 0;
}

export function configuredPasscode(): string | null {
  const value = process.env.KILO_PASSCODE?.trim();
  return value ? value : null;
}
