/* The store seam: MongoDB when MONGODB_URI is set, JSON file otherwise.
   Both implementations share one async interface (see stores/). */
import { DATA_DIR } from "./env.js";
import { createJsonStore } from "./stores/json.js";
import { createMongoStoreFromUrl } from "./stores/mongo.js";

const store = process.env.MONGODB_URI
  ? await createMongoStoreFromUrl(process.env.MONGODB_URI)
  : createJsonStore(DATA_DIR);

console.log(`[store] backend: ${store.kind}`);
export const accounts = store.accounts;
export const households = store.households;
