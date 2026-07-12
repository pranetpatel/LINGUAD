/* MongoDB store — the production implementation behind the store seam.
   Optimistic concurrency via a filtered `version` match on updateOne. */

const rowAcc = (d) => d ? { id: d._id, email: d.email, name: d.name, salt: d.salt, passHash: d.passHash, type: d.type } : null;

export async function createMongoStore(db) {
  const accountsCol = db.collection("accounts");
  const householdsCol = db.collection("households");
  await accountsCol.createIndex({ email: 1 }, { unique: true });

  return {
    kind: "mongo",
    accounts: {
      async byEmail(email) {
        return rowAcc(await accountsCol.findOne({ email: email.toLowerCase() }));
      },
      async byId(id) {
        return rowAcc(await accountsCol.findOne({ _id: id }));
      },
      async create(acc) {
        await accountsCol.insertOne({ _id: acc.id, email: acc.email, name: acc.name, salt: acc.salt, passHash: acc.passHash, type: acc.type, createdAt: new Date() });
        return acc;
      },
    },
    households: {
      async get(accountId) {
        const d = await householdsCol.findOne({ _id: accountId });
        return d ? { version: d.version, data: d.data } : null;
      },
      async init(accountId, data) {
        await householdsCol.insertOne({ _id: accountId, version: 1, data, updatedAt: new Date() });
        return { version: 1, data };
      },
      async put(accountId, baseVersion, data) {
        const upd = await householdsCol.updateOne(
          { _id: accountId, version: baseVersion },
          { $set: { data, updatedAt: new Date() }, $inc: { version: 1 } });
        if (upd.modifiedCount) {
          const cur = await householdsCol.findOne({ _id: accountId });
          return { ok: true, version: cur.version };
        }
        const cur = await householdsCol.findOne({ _id: accountId });
        if (!cur) {
          await householdsCol.insertOne({ _id: accountId, version: 1, data, updatedAt: new Date() });
          return { ok: true, version: 1 };
        }
        return { ok: false, version: cur.version, data: cur.data };
      },
      async reset(accountId, data) {
        const cur = await householdsCol.findOne({ _id: accountId });
        if (!cur) {
          await householdsCol.insertOne({ _id: accountId, version: 1, data, updatedAt: new Date() });
          return { version: 1, data };
        }
        const version = cur.version + 1;
        await householdsCol.updateOne({ _id: accountId }, { $set: { data, updatedAt: new Date(), version } });
        return { version, data };
      },
    },
  };
}

export async function createMongoStoreFromUrl(connectionString) {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(connectionString);
  await client.connect();
  const url = new URL(connectionString.replace(/^mongodb\+srv:/, "https:").replace(/^mongodb:/, "https:"));
  const dbName = url.pathname.replace(/^\//, "") || "lingua";
  return createMongoStore(client.db(dbName));
}
