import { NextResponse } from "next/server";
import { RequestError } from "./http";

/** JSON error responses shared by the API routes. */

export function errorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof RequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export function tooManyRequests(retryAfter: number, message: string): NextResponse {
  return NextResponse.json(
    { error: message },
    { status: 429, headers: { "retry-after": String(retryAfter) } },
  );
}
