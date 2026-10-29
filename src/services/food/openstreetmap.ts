// Real restaurants, cafés and fast-food places around any point, from
// OpenStreetMap through the public Overpass API. Free and keyless, but slow
// (often 10-20s) and sometimes overloaded, so:
// - results are cached for ~1 km grid cells and several servers are tried,
// - osm-snapshot.json (scripts/update-food-snapshot.ts) answers instantly
//   near saved spots while live data loads in the background,
// - after a failure the same cell isn't retried for a few minutes.

import { cuisineFor } from "./cuisines";
import savedSnapshot from "./osm-snapshot.json";
import { distanceKm, type Place } from "./types";

const OVERPASS_ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];
// Small towns have few places close by, so a thin result widens the search.
const RADII_METERS = [2000, 6000, 15000];
const ENOUGH_PLACES = 10;
const MAX_PLACES = 40;
const CACHE_MS = 12 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 5 * 60 * 1000;
// A saved spot covers searches within this distance of it.
const SNAPSHOT_REACH_KM = 3;

type Point = { lat: number; lon: number };

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: Point;
  tags?: Record<string, string>;
};

export type SnapshotSpot = Point & { name: string; radiusKm: number; places: Place[] };

export type NearbyPlaces = {
  places: (Place & { distanceKm: number })[];
  radiusKm: number;
};

const snapshot = (savedSnapshot as unknown as { spots?: SnapshotSpot[] }).spots ?? [];
const cache = new Map<string, { at: number; result: { center: Point; radiusKm: number; places: Place[] } }>();
const pending = new Map<string, Promise<{ center: Point; radiusKm: number; places: Place[] }>>();
const failedAt = new Map<string, number>();

async function overpass(query: string): Promise<OverpassElement[]> {
  let lastError: unknown;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "PropzingBot/1.0 (Telegram travel bot, food ordering demo)",
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`Overpass ${new URL(endpoint).host} returned ${response.status}`);
      const data = await response.json() as { elements?: OverpassElement[] };
      return data.elements ?? [];
    } catch (error) {
      lastError = error;
      console.warn(`Overpass ${new URL(endpoint).host} failed:`, error instanceof Error ? error.message : error);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("OpenStreetMap is unavailable");
}

function toPlace(element: OverpassElement): Place | undefined {
  const tags = element.tags ?? {};
  const name = (tags["name:en"] || tags.name)?.trim();
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (!name || lat === undefined || lon === undefined) return undefined;

  const address = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ") ||
    tags["addr:place"] || undefined;

  return {
    id: `osm-${element.type[0]}${element.id}`,
    name,
    cuisineKey: cuisineFor(tags.cuisine, tags.amenity).key,
    lat,
    lon,
    address,
    openingHours: tags.opening_hours,
  };
}

async function placesWithin(center: Point, radiusMeters: number): Promise<Place[]> {
  const elements = await overpass(
    `[out:json][timeout:25];` +
    `nwr["amenity"~"^(restaurant|fast_food|cafe)$"]["name"](around:${radiusMeters},${center.lat},${center.lon});` +
    `out center tags 400;`,
  );

  // Chains appear many times; keep the closest branch of each name.
  const byName = new Map<string, Place>();
  for (const element of elements) {
    const place = toPlace(element);
    if (!place) continue;
    const key = place.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing || distanceKm(center, place) < distanceKm(center, existing)) byName.set(key, place);
  }
  return [...byName.values()];
}

// Searches the smallest radius that finds enough places.
export async function fetchPlaces(center: Point): Promise<{ center: Point; radiusKm: number; places: Place[] }> {
  let places: Place[] = [];
  let radius = RADII_METERS[0]!;
  for (radius of RADII_METERS) {
    places = await placesWithin(center, radius);
    if (places.length >= ENOUGH_PLACES) break;
  }
  return { center, radiusKm: radius / 1000, places };
}

function cellKey(point: Point): string {
  return `${point.lat.toFixed(2)},${point.lon.toFixed(2)}`;
}

function refresh(key: string, point: Point) {
  let request = pending.get(key);
  if (!request) {
    request = fetchPlaces(point)
      .then((result) => {
        cache.set(key, { at: Date.now(), result });
        return result;
      })
      .catch((error) => {
        failedAt.set(key, Date.now());
        throw error;
      })
      .finally(() => pending.delete(key));
    pending.set(key, request);
  }
  return request;
}

function nearestSpot(point: Point, reachKm: number): SnapshotSpot | undefined {
  return snapshot
    .map((spot) => ({ spot, distance: distanceKm(point, spot) }))
    .filter(({ distance }) => distance <= reachKm)
    .sort((a, b) => a.distance - b.distance)[0]?.spot;
}

function nearest(point: Point, places: Place[], radiusKm: number): NearbyPlaces {
  return {
    radiusKm,
    places: places
      .map((place) => ({ ...place, distanceKm: Math.round(distanceKm(point, place) * 10) / 10 }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, MAX_PLACES),
  };
}

export async function placesNear(point: Point): Promise<NearbyPlaces> {
  const key = cellKey(point);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return nearest(point, cached.result.places, cached.result.radiusKm);

  const recentlyFailed = Date.now() - (failedAt.get(key) ?? 0) < RETRY_AFTER_MS;
  const spot = nearestSpot(point, SNAPSHOT_REACH_KM);

  // Saved data now, fresh data for the next search.
  if (spot) {
    if (!recentlyFailed) refresh(key, point).catch((error) => console.warn(`OpenStreetMap refresh failed: ${error.message}`));
    const source = cached?.result ?? spot;
    return nearest(point, source.places, source.radiusKm);
  }
  if (cached) return nearest(point, cached.result.places, cached.result.radiusKm);
  if (recentlyFailed) throw new Error("OpenStreetMap is busy, try again in a few minutes");

  const result = await refresh(key, point);
  return nearest(point, result.places, result.radiusKm);
}
