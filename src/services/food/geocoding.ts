// Turns typed places ("Neyveli", "T. Nagar, Chennai") into coordinates and
// live locations into a readable label, using OpenStreetMap's Nominatim.
// Its usage policy allows at most one request per second and asks for
// results to be cached, so calls are queued and cached here.

import type { FoodLocation } from "./types";

const BASE_URL = "https://nominatim.openstreetmap.org";
const USER_AGENT = "PropzingBot/1.0 (Telegram travel bot, food ordering demo)";
const CACHE_MS = 24 * 60 * 60 * 1000;

type NominatimAddress = Record<string, string | undefined>;

type NominatimResult = {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  address?: NominatimAddress;
};

const cache = new Map<string, { at: number; result: Promise<FoodLocation | undefined> }>();
let queue: Promise<unknown> = Promise.resolve();

// Runs Nominatim requests one at a time, at least a second apart.
function throttled<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined).then(() => Bun.sleep(1000));
  return run;
}

async function nominatim<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = `${BASE_URL}${path}?${new URLSearchParams({ format: "jsonv2", addressdetails: "1", ...params })}`;
  return throttled(async () => {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Location lookup failed (${response.status})`);
    return await response.json() as T;
  });
}

// "Thyagaraya Nagar, Chennai, India" rather than the full postal address.
function shortLabel(result: NominatimResult): string {
  const address = result.address ?? {};
  const local = result.name || address.road || address.neighbourhood || address.suburb || address.quarter;
  const city = address.city || address.town || address.village || address.municipality || address.county || address.state_district;
  const parts = [local, city !== local ? city : undefined, address.state, address.country].filter(Boolean);
  return [...new Set(parts)].slice(0, 3).join(", ") || result.display_name;
}

function toLocation(result: NominatimResult): FoodLocation {
  return {
    lat: Number(result.lat),
    lon: Number(result.lon),
    label: shortLabel(result),
    countryCode: result.address?.country_code,
  };
}

function cached(key: string, load: () => Promise<FoodLocation | undefined>): Promise<FoodLocation | undefined> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;

  const result = load().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { at: Date.now(), result });
  return result;
}

export function geocode(place: string): Promise<FoodLocation | undefined> {
  const query = place.trim().replace(/\s+/g, " ");
  return cached(`search:${query.toLowerCase()}`, async () => {
    const results = await nominatim<NominatimResult[]>("/search", { q: query, limit: "1" });
    return results[0] && toLocation(results[0]);
  });
}

// Coordinates are rounded to ~100 m so nearby lookups share the cache.
export function reverseGeocode(lat: number, lon: number): Promise<FoodLocation | undefined> {
  const key = `reverse:${lat.toFixed(3)},${lon.toFixed(3)}`;
  return cached(key, async () => {
    const result = await nominatim<NominatimResult & { error?: string }>("/reverse", {
      lat: String(lat),
      lon: String(lon),
      zoom: "16",
    });
    return result.error ? undefined : { ...toLocation(result), lat, lon };
  });
}
