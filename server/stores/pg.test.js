import { test, before } from "node:test";
import assert from "node:assert";
import { newDb } from "pg-mem";
import { createPgStore } from "./pg.js";

let store;
before(async () => {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  store = await createPgStore(new Pool());
});

test("account create + lookup by email and id", async () => {
  const acc = { id: "11111111-1111-1111-1111-111111111111", email: "a@b.com", name: "Dana", salt: "s", passHash: "h", type: "family" };
  await store.accounts.create(acc);
  const byEmail = await store.accounts.byEmail("A@B.com");
  assert.equal(byEmail.id, acc.id);
  assert.equal(byEmail.passHash, "h");
  const byId = await store.accounts.byId(acc.id);
  assert.equal(byId.email, "a@b.com");
});

test("household init/get round-trips JSONB", async () => {
  const id = "22222222-2222-2222-2222-222222222222";
  await store.households.init(id, { type: "family", members: [{ id: "m1", name: "Kid" }] });
  const hh = await store.households.get(id);
  assert.equal(hh.version, 1);
  assert.equal(hh.data.members[0].name, "Kid");
});

test("reset bumps version and replaces data (and inserts when absent)", async () => {
  const id = "44444444-4444-4444-4444-444444444444";
  await store.households.init(id, { members: [{ id: "m1" }] });
  await store.households.put(id, 1, { members: [{ id: "m1" }, { id: "m2" }] }); // v2
  const r = await store.households.reset(id, { members: [] });
  assert.equal(r.version, 3);                       // keeps climbing so stale devices adopt it
  const after = await store.households.get(id);
  assert.equal(after.version, 3);
  assert.deepEqual(after.data.members, []);
  const fresh = await store.households.reset("55555555-5555-5555-5555-555555555555", { members: [] });
  assert.equal(fresh.version, 1);                   // reset on missing row inserts v1
});

test("optimistic concurrency: correct base bumps, stale base conflicts with latest", async () => {
  const id = "33333333-3333-3333-3333-333333333333";
  await store.households.init(id, { members: [] });
  const ok = await store.households.put(id, 1, { members: [{ id: "m1" }] });
  assert.deepEqual(ok, { ok: true, version: 2 });
  const stale = await store.households.put(id, 1, { members: [] });
  assert.equal(stale.ok, false);
  assert.equal(stale.version, 2);
  assert.equal(stale.data.members[0].id, "m1"); // conflict returns the newer copy
});
