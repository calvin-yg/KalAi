import { NextResponse } from "next/server";
import { GATE_COOKIE, configuredPasscode, passcodeMatches, passcodeToken } from "@/lib/gate";
import { RateLimiter, clientKey, readJson } from "@/lib/http";
import { errorResponse, tooManyRequests } from "@/lib/responses";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 4 * 1024;

/**
 * A short shared passcode is guessable at machine speed. Ten attempts per
 * fifteen minutes keeps it usable for someone typing on a phone and useless
 * for anyone working through a wordlist.
 */
const limiter = new RateLimiter(10, 15 * 60 * 1000);

export async function POST(request: Request) {
  const passcode = configuredPasscode();
  if (!passcode) return NextResponse.json({ ok: true });

  const wait = limiter.check(clientKey(request));
  if (wait !== null) {
    return tooManyRequests(wait, "Too many attempts. Wait a few minutes and try again.");
  }

  let body: Record<string, unknown>;
  try {
    body = await readJson(request, MAX_BODY_BYTES);
  } catch (error) {
    return errorResponse(error, "Could not read that request.");
  }

  if (
    typeof body.passcode !== "string" ||
    !(await passcodeMatches(body.passcode, passcode))
  ) {
    return NextResponse.json({ error: "That passcode isn't right." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: GATE_COOKIE,
    value: await passcodeToken(passcode),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
