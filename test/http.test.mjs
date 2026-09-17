/** Checks for the request caps and rate limiting that guard the API routes. */
import assert from "node:assert/strict";
import test from "node:test";
import { RateLimiter, RequestError, readJson } from "../src/lib/http.ts";

const json = (body, headers = {}) =>
  new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("reads a normal body", async () => {
  assert.deepEqual(await readJson(json({ a: 1 }), 1024), { a: 1 });
});

test("refuses a body over the cap", async () => {
  await assert.rejects(
    () => readJson(json({ junk: "A".repeat(2048) }), 1024),
    (error) => error instanceof RequestError && error.status === 413,
  );
});

test("refuses an oversized body even when Content-Length understates it", async () => {
  // A client can claim anything; the measured read is what protects memory.
  const request = json({ junk: "A".repeat(4096) }, { "content-length": "10" });
  await assert.rejects(
    () => readJson(request, 1024),
    (error) => error instanceof RequestError && error.status === 413,
  );
});

test("rejects malformed JSON and non-objects", async () => {
  await assert.rejects(
    () => readJson(json("not json at all"), 1024),
    (error) => error instanceof RequestError && error.status === 400,
  );
  await assert.rejects(
    () => readJson(json([1, 2, 3]), 1024),
    (error) => error instanceof RequestError && error.status === 400,
  );
});

test("rate limiter allows up to the limit, then holds the caller off", () => {
  const limiter = new RateLimiter(3, 60_000);
  assert.equal(limiter.check("a"), null);
  assert.equal(limiter.check("a"), null);
  assert.equal(limiter.check("a"), null);
  const wait = limiter.check("a");
  assert.ok(typeof wait === "number" && wait > 0, "fourth call should be held off");
});

test("rate limiter keeps callers separate", () => {
  const limiter = new RateLimiter(1, 60_000);
  assert.equal(limiter.check("phone-a"), null);
  assert.ok(limiter.check("phone-a") !== null);
  // One person hitting the limit must not lock the other out.
  assert.equal(limiter.check("phone-b"), null);
});

test("rate limiter lets the window expire", async () => {
  const limiter = new RateLimiter(1, 20);
  assert.equal(limiter.check("a"), null);
  assert.ok(limiter.check("a") !== null);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(limiter.check("a"), null);
});
