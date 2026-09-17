import { cookies } from "next/headers";

/**
 * Which of the household's profiles a request belongs to. There is no login —
 * the deployment is shared by people who trust each other, and the passcode
 * gate (if set) keeps strangers out of the deployment as a whole.
 */
export const USER_IDS = ["one", "two"] as const;
export type UserId = (typeof USER_IDS)[number];

export const DEFAULT_USER: UserId = "one";

export function isUserId(value: string | null | undefined): value is UserId {
  return value === "one" || value === "two";
}

/** Read the profile from ?user=, falling back to the cookie, then to the first. */
export async function userIdFrom(request: Request): Promise<UserId> {
  const fromQuery = new URL(request.url).searchParams.get("user");
  if (isUserId(fromQuery)) return fromQuery;

  const fromCookie = (await cookies()).get("kilo_user")?.value;
  return isUserId(fromCookie) ? fromCookie : DEFAULT_USER;
}
