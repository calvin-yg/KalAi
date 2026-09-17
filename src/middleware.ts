import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { GATE_COOKIE, configuredPasscode, passcodeToken, tokenMatches } from "@/lib/gate";

/** Paths that must stay reachable so the gate itself can be used. */
const OPEN_PATHS = ["/login", "/api/login"];

let warnedAboutOpenDeployment = false;

export async function middleware(request: NextRequest) {
  const passcode = configuredPasscode();
  if (!passcode) {
    // Easy to forget, and the failure mode is silent: a personal food log
    // readable and writable by anyone who finds the URL.
    if (process.env.NODE_ENV === "production" && !warnedAboutOpenDeployment) {
      warnedAboutOpenDeployment = true;
      console.warn(
        "KILO_PASSCODE is not set — this deployment is open to anyone who knows the URL.",
      );
    }
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (OPEN_PATHS.some((path) => pathname.startsWith(path))) return NextResponse.next();

  const presented = request.cookies.get(GATE_COOKIE)?.value;
  if (presented && tokenMatches(presented, await passcodeToken(passcode))) {
    return NextResponse.next();
  }

  // API calls get a status they can act on; page loads get the passcode screen.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Locked." }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next's own assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
