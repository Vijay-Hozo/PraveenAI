// Saves restaurants for every Dubai area from OpenStreetMap to
// src/services/food/osm-snapshot.json. The bot uses the snapshot when the
// public Overpass servers are busy. Run it again to refresh the data:
//   bun run scripts/update-food-snapshot.ts

import { join } from "node:path";
import { DUBAI_AREAS } from "../src/services/food/areas";
import { fetchRestaurants } from "../src/services/food/openstreetmap";
import type { Restaurant } from "../src/services/food/types";

const outFile = join(import.meta.dir, "..", "src", "services", "food", "osm-snapshot.json");
const existing = await Bun.file(outFile).json().catch(() => ({ areas: {} })) as {
  areas: Record<string, Restaurant[]>;
};

const areas: Record<string, Restaurant[]> = { ...existing.areas };

for (const area of DUBAI_AREAS) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const restaurants = await fetchRestaurants(area.name, area);
      areas[area.name] = restaurants;
      console.log(`${area.name}: ${restaurants.length} restaurants`);
      break;
    } catch (error) {
      const wait = 5000 * 2 ** (attempt - 1);
      console.warn(`${area.name}: attempt ${attempt} failed (${error instanceof Error ? error.message : error}), retrying in ${wait / 1000}s`);
      await Bun.sleep(wait);
    }
  }
  if (!areas[area.name]) console.error(`${area.name}: no data`);
}

await Bun.write(outFile, JSON.stringify({
  source: "© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)",
  updatedAt: new Date().toISOString(),
  areas,
}, null, 1) + "\n");
console.log(`Saved ${outFile}`);
