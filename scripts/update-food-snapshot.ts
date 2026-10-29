// Saves OpenStreetMap restaurants around the spots in
// src/services/food/presets.ts to src/services/food/osm-snapshot.json.
// Searches near those spots then answer instantly even when the public
// Overpass servers are busy; every other location is looked up live.
// Spots that fail keep their previous data. Run it again to refresh:
//   bun run scripts/update-food-snapshot.ts

import { join } from "node:path";
import { fetchPlaces, type SnapshotSpot } from "../src/services/food/openstreetmap";
import { SNAPSHOT_SPOTS } from "../src/services/food/presets";

const outFile = join(import.meta.dir, "..", "src", "services", "food", "osm-snapshot.json");
const existing = await Bun.file(outFile).json().catch(() => ({})) as { spots?: SnapshotSpot[] };
const previous = new Map((existing.spots ?? []).map((spot) => [spot.name, spot]));

const spots: SnapshotSpot[] = [];

for (const preset of SNAPSHOT_SPOTS) {
  let saved = false;
  for (let attempt = 1; attempt <= 4 && !saved; attempt++) {
    try {
      const { radiusKm, places } = await fetchPlaces(preset);
      spots.push({ name: preset.name, lat: preset.lat, lon: preset.lon, radiusKm, places });
      console.log(`${preset.name}: ${places.length} places within ${radiusKm} km`);
      saved = true;
    } catch (error) {
      const wait = 5000 * 2 ** (attempt - 1);
      console.warn(`${preset.name}: attempt ${attempt} failed (${error instanceof Error ? error.message : error}), retrying in ${wait / 1000}s`);
      await Bun.sleep(wait);
    }
  }
  if (!saved) {
    const old = previous.get(preset.name);
    if (old) spots.push(old);
    console.error(`${preset.name}: no new data${old ? ", kept the previous snapshot" : ""}`);
  }
}

await Bun.write(outFile, JSON.stringify({
  source: "© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)",
  updatedAt: new Date().toISOString(),
  spots,
}) + "\n");
console.log(`Saved ${spots.length} spots to ${outFile}`);
