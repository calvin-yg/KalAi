import { NextResponse } from "next/server";
import { GATE_COOKIE, configuredPasscode, passcodeToken } from "@/lib/gate";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const passcode = configuredPasscode();
  if (!passcode) return NextResponse.json({ ok: true });

  let body: { passcode?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (typeof body.passcode !== "string" || body.passcode !== passcode) {
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
