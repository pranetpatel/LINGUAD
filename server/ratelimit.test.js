import { test } from "node:test";
import assert from "node:assert";
import { makeLimiter } from "./ratelimit.js";

test("allows up to max then blocks with retryAfter", () => {
  let t = 0;
  const lim = makeLimiter({ windowMs: 1000, max: 3, name: "t1" }, () => t);
  assert.ok(lim.check("a").ok);
  assert.ok(lim.check("a").ok);
  assert.ok(lim.check("a").ok);
  const fourth = lim.check("a");
  assert.equal(fourth.ok, false);
  assert.ok(fourth.retryAfter >= 1);
});

test("keys are independent and windows reset", () => {
  let t = 0;
  const lim = makeLimiter({ windowMs: 1000, max: 1, name: "t2" }, () => t);
  assert.ok(lim.check("a").ok);
  assert.ok(lim.check("b").ok);          // different key unaffected
  assert.equal(lim.check("a").ok, false);
  t = 1500;                               // window elapses
  assert.ok(lim.check("a").ok);
});
