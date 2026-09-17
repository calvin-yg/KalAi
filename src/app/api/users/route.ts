import { NextResponse } from "next/server";
import { listUsers } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ users: await listUsers() });
}
