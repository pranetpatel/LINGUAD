/* JSON-file store — async interface matching stores/pg.js exactly. */
import fs from "node:fs";
import path from "node:path";

export function createJsonStore(dataDir) {
  const FILE = path.join(dataDir, "db.json");
  let db = { accounts: {}, households: {} };
  if (fs.existsSync(FILE)) { try { db = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch {} }
  let queue = Promise.resolve();
  const flush = () => (queue = queue.then(() => new Promise((res) => {
    const tmp = FILE + ".tmp";
    fs.writeFile(tmp, JSON.stringify(db), (e) => (e ? res() : fs.rename(tmp, FILE, () => res())));
  })));

  return {
    kind: "json",
    accounts: {
      async byEmail(email) { return db.accounts[email.toLowerCase()] || null; },
      async byId(id) { return Object.values(db.accounts).find(a => a.id === id) || null; },
      async create(acc) { db.accounts[acc.email] = acc; flush(); return acc; },
    },
    households: {
      async get(accountId) { return db.households[accountId] || null; },
      async init(accountId, data) { db.households[accountId] = { version: 1, data }; flush(); return db.households[accountId]; },
      async put(accountId, baseVersion, data) {
        const cur = db.households[accountId];
        if (!cur) { db.households[accountId] = { version: 1, data }; flush(); return { ok: true, version: 1 }; }
        if (baseVersion !== cur.version) return { ok: false, version: cur.version, data: cur.data };
        cur.version += 1; cur.data = data; flush();
        return { ok: true, version: cur.version };
      },
      async reset(accountId, data) {
        const cur = db.households[accountId];
        const version = (cur?.version || 0) + 1; // version keeps climbing so other devices adopt the reset
        db.households[accountId] = { version, data };
        flush();
        return { version, data };
      },
    },
  };
}
