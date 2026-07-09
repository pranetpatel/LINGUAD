/* The store seam: Postgres when DATABASE_URL is set, JSON file otherwise.
   Both implementations share one async interface (see stores/). */
import { DATA_DIR } from "./env.js";
import { createJsonStore } from "./stores/json.js";
import { createPgStoreFromUrl } from "./stores/pg.js";

const store = process.env.DATABASE_URL
  ? await createPgStoreFromUrl(process.env.DATABASE_URL)
  : createJsonStore(DATA_DIR);

console.log(`[store] backend: ${store.kind}`);
export const accounts = store.accounts;
export const households = store.households;
