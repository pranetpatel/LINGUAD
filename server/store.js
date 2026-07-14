/* The store seam: Postgres when DATABASE_URL is set, MongoDB when MONGODB_URI
   is set, JSON file otherwise. All three implementations share one async
   interface (see stores/). Postgres takes priority since it's the newer,
   preferred backend; MONGODB_URI stays supported so existing deploys that
   haven't migrated DATABASE_URL yet don't silently fall back to the
   ephemeral JSON store. */
import { DATA_DIR } from "./env.js";
import { createJsonStore } from "./stores/json.js";
import { createMongoStoreFromUrl } from "./stores/mongo.js";
import { createPgStoreFromUrl } from "./stores/pg.js";

const store = process.env.DATABASE_URL
  ? await createPgStoreFromUrl(process.env.DATABASE_URL)
  : process.env.MONGODB_URI
  ? await createMongoStoreFromUrl(process.env.MONGODB_URI)
  : createJsonStore(DATA_DIR);

console.log(`[store] backend: ${store.kind}`);
export const accounts = store.accounts;
export const households = store.households;
