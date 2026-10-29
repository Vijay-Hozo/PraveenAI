// Real restaurants, cafés and fast-food places from OpenStreetMap through the
// public Overpass API. Free and keyless, but slow (often 10-20s) and
// sometimes overloaded, so results are cached per area, several servers are
// tried in turn, and osm-snapshot.json (scripts/update-food-snapshot.ts)
// covers the time Overpass is busy.

import { cuisineFor } from "./cuisines";
import savedSnapshot from "./osm-snapshot.json";
import { pick, type Restaurant } from "./types";

const OVERPASS_ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];
const RADIUS_METERS = 1200;
const MAX_RESULTS = 40;
const CACHE_MS = 12 * 60 * 60 * 1000;

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

// After a failed request, skip Overpass for this long instead of making every
// search wait for another timeout.
const RETRY_AFTER_MS = 5 * 60 * 1000;

const cache = new Map<string, { at: number; restaurants: Restaurant[] }>();
const pending = new Map<string, Promise<Restaurant[]>>();
const failedAt = new Map<string, number>();
const snapshot = savedSnapshot as unknown as { areas: Record<string, Restaurant[]> };

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

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
      console.warn("Overpass request failed:", error instanceof Error ? error.message : error);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("OpenStreetMap is unavailable");
}

function toRestaurant(element: OverpassElement, area: string, center: { lat: number; lon: number }): Restaurant | undefined {
  const tags = element.tags ?? {};
  const name = (tags["name:en"] || tags.name)?.trim();
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (!name || lat === undefined || lon === undefined) return undefined;

  const id = `osm-${element.type[0]}${element.id}`;
  const cuisine = cuisineFor(tags.cuisine, tags.amenity);
  const address = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ") ||
    tags["addr:place"] || undefined;

  return {
    id,
    name,
    cuisine: cuisine.label,
    emoji: cuisine.emoji,
    distanceKm: Math.round(distanceKm(center.lat, center.lon, lat, lon) * 10) / 10,
    address,
    openingHours: tags.opening_hours,
    // OpenStreetMap has no delivery data, so these are generated per place.
    prepMinutes: pick(`${id}:prep`, [10, 15, 20, 25]),
    deliveryFee: pick(`${id}:fee`, [0, 3, 5, 7, 9]),
    minimumOrder: cuisine.key === "cafe" ? pick(`${id}:min`, [15, 20, 25]) : pick(`${id}:min`, [25, 30, 40, 50]),
    areas: [area],
    source: "openstreetmap",
  };
}

export async function fetchRestaurants(area: string, center: { lat: number; lon: number }): Promise<Restaurant[]> {
  const query =
    `[out:json][timeout:25];` +
    `nwr["amenity"~"^(restaurant|fast_food|cafe)$"]["name"](around:${RADIUS_METERS},${center.lat},${center.lon});` +
    `out center tags 300;`;
  const elements = await overpass(query);

  // Chains appear many times; keep the closest branch of each name.
  const byName = new Map<string, Restaurant>();
  for (const element of elements) {
    const restaurant = toRestaurant(element, area, center);
    if (!restaurant) continue;
    const key = restaurant.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing || (restaurant.distanceKm ?? 0) < (existing.distanceKm ?? 0)) byName.set(key, restaurant);
  }

  return [...byName.values()]
    .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
    .slice(0, MAX_RESULTS);
}

function refresh(area: string, center: { lat: number; lon: number }): Promise<Restaurant[]> {
  // Concurrent searches for the same area share one Overpass request.
  let request = pending.get(area);
  if (!request) {
    request = fetchRestaurants(area, center)
      .then((restaurants) => {
        if (restaurants.length) cache.set(area, { at: Date.now(), restaurants });
        return restaurants;
      })
      .catch((error) => {
        failedAt.set(area, Date.now());
        throw error;
      })
      .finally(() => pending.delete(area));
    pending.set(area, request);
  }
  return request;
}

// Live data when cached; otherwise the saved snapshot right away while live
// data loads in the background for the next search. Areas without a snapshot
// wait for Overpass.
export async function restaurantsNear(area: string, center: { lat: number; lon: number }): Promise<Restaurant[]> {
  const cached = cache.get(area);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.restaurants;

  const recentlyFailed = Date.now() - (failedAt.get(area) ?? 0) < RETRY_AFTER_MS;
  const saved = snapshot.areas[area];

  if (saved?.length) {
    if (!recentlyFailed) refresh(area, center).catch((error) => console.warn(`OpenStreetMap refresh for ${area} failed:`, error.message));
    return cached?.restaurants ?? saved;
  }
  if (cached) return cached.restaurants;
  if (recentlyFailed) throw new Error("OpenStreetMap is busy, try again in a few minutes");
  return refresh(area, center);
}
