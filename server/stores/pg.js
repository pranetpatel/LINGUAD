/* Postgres store — the production implementation behind the store seam.
   Optimistic concurrency via `UPDATE … WHERE version = $base`. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  salt TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'family',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS households (
  account_id UUID PRIMARY KEY,
  version INTEGER NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`;

const rowAcc = (r) => r ? { id: r.id, email: r.email, name: r.name, salt: r.salt, passHash: r.pass_hash, type: r.type } : null;

export async function createPgStore(pool) {
  for (const stmt of SCHEMA.split(";")) if (stmt.trim()) await pool.query(stmt);
  return {
    kind: "pg",
    accounts: {
      async byEmail(email) {
        const r = await pool.query("SELECT * FROM accounts WHERE email = $1", [email.toLowerCase()]);
        return rowAcc(r.rows[0]);
      },
      async byId(id) {
        const r = await pool.query("SELECT * FROM accounts WHERE id = $1", [id]);
        return rowAcc(r.rows[0]);
      },
      async create(acc) {
        await pool.query(
          "INSERT INTO accounts (id, email, name, salt, pass_hash, type) VALUES ($1,$2,$3,$4,$5,$6)",
          [acc.id, acc.email, acc.name, acc.salt, acc.passHash, acc.type]);
        return acc;
      },
    },
    households: {
      async get(accountId) {
        const r = await pool.query("SELECT version, data FROM households WHERE account_id = $1", [accountId]);
        return r.rows[0] ? { version: r.rows[0].version, data: r.rows[0].data } : null;
      },
      async init(accountId, data) {
        await pool.query("INSERT INTO households (account_id, version, data) VALUES ($1, 1, $2)", [accountId, JSON.stringify(data)]);
        return { version: 1, data };
      },
      async put(accountId, baseVersion, data) {
        const upd = await pool.query(
          "UPDATE households SET version = version + 1, data = $3, updated_at = now() WHERE account_id = $1 AND version = $2 RETURNING version",
          [accountId, baseVersion, JSON.stringify(data)]);
        if (upd.rowCount) return { ok: true, version: upd.rows[0].version };
        const cur = await pool.query("SELECT version, data FROM households WHERE account_id = $1", [accountId]);
        if (!cur.rowCount) {
          await pool.query("INSERT INTO households (account_id, version, data) VALUES ($1, 1, $2)", [accountId, JSON.stringify(data)]);
          return { ok: true, version: 1 };
        }
        return { ok: false, version: cur.rows[0].version, data: cur.rows[0].data };
      },
      async reset(accountId, data) {
        const upd = await pool.query(
          "UPDATE households SET version = version + 1, data = $2, updated_at = now() WHERE account_id = $1 RETURNING version",
          [accountId, JSON.stringify(data)]);
        if (upd.rowCount) return { version: upd.rows[0].version, data };
        await pool.query("INSERT INTO households (account_id, version, data) VALUES ($1, 1, $2)", [accountId, JSON.stringify(data)]);
        return { version: 1, data };
      },
    },
  };
}

export async function createPgStoreFromUrl(connectionString) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString, max: 10 });
  return createPgStore(pool);
}
