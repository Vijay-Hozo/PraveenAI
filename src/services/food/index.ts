// Food ordering for the Mini App (test mode), for any location:
// 1. a typed place or live location is resolved with OpenStreetMap Nominatim,
// 2. real restaurants around it come from OpenStreetMap (Overpass),
// 3. menus are dishes and photos from TheMealDB matching each cuisine,
// 4. prices, fees and tax follow the country's currency (regions.ts).
// No public API can place orders with delivery apps, so prices, ordering and
// delivery are simulated. Fictional sample restaurants are used when
// OpenStreetMap can't be reached.

import { cuisineByKey, cuisineForSearch, localCuisine } from "./cuisines";
import { geocode, reverseGeocode } from "./geocoding";
import { placesNear } from "./openstreetmap";
import { localPrice, pricingFor, regionFor } from "./regions";
import { sampleRestaurants } from "./sample";
import { menuFor } from "./themealdb";
import {
  distanceKm,
  pick,
  type FoodDelivery,
  type FoodLocation,
  type FoodOrder,
  type FoodOrderLine,
  type FoodOrderStatus,
  type MenuItem,
  type Place,
  type Restaurant,
  type RestaurantSummary,
} from "./types";

export type { FoodLocation, FoodOrder };

// Restaurants farther than this from the delivery point can't take the order.
// Matches the widest OpenStreetMap search radius used for small towns.
const MAX_DELIVERY_KM = 15;
// With fewer real places than this, sample restaurants are added so there's
// enough to choose from.
const FEW_PLACES = 3;

// Simulated timeline in seconds after the order, compressed so a test run
// finishes in a couple of minutes.
export const STATUS_TIMELINE: { status: FoodOrderStatus; afterSeconds: number; label: string }[] = [
  { status: "placed", afterSeconds: 0, label: "Order placed" },
  { status: "preparing", afterSeconds: 15, label: "Restaurant is preparing your food" },
  { status: "out_for_delivery", afterSeconds: 60, label: "Rider is on the way" },
  { status: "delivered", afterSeconds: 120, label: "Delivered" },
];

// Every restaurant shown to a user, so menus and orders can look it up by ID.
const restaurants = new Map<string, Restaurant & { countryCode?: string }>();
const menus = new Map<string, MenuItem[]>();

export class FoodLocationError extends Error {}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function isCoordinate(lat: unknown, lon: unknown): lat is number {
  return typeof lat === "number" && typeof lon === "number" &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
}

// A typed place ("Neyveli", "T. Nagar, Chennai") or coordinates from a live location.
export async function resolveLocation(input: { place?: string; lat?: unknown; lon?: unknown }): Promise<FoodLocation> {
  if (isCoordinate(input.lat, input.lon)) {
    const lat = input.lat;
    const lon = input.lon as number;
    const found = await reverseGeocode(lat, lon).catch((error) => {
      console.warn("Reverse geocoding failed:", error instanceof Error ? error.message : error);
      return undefined;
    });
    return found ?? { lat, lon, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
  }

  const place = input.place?.trim();
  if (!place) throw new FoodLocationError("Enter a delivery location or use your current location");
  const found = await geocode(place);
  if (!found) throw new FoodLocationError(`Couldn't find "${place}". Try adding the city, e.g. "T. Nagar, Chennai".`);
  return found;
}

function summarize(restaurant: Restaurant): RestaurantSummary {
  const { lat: _lat, lon: _lon, halal: _halal, ...summary } = restaurant;
  return { ...summary, etaMinutes: restaurant.prepMinutes + 10 + Math.round((restaurant.distanceKm ?? 2) * 3) };
}

function fromPlace(place: Place & { distanceKm: number }, location: FoodLocation): Restaurant {
  const region = regionFor(location.countryCode);
  const { halal, ...pricing } = pricingFor(location.countryCode);
  const cuisine = localCuisine(place.cuisineKey, location.countryCode);

  return {
    id: place.id,
    name: place.name,
    cuisine: cuisine.label,
    cuisineKey: cuisine.key,
    emoji: cuisine.emoji,
    lat: place.lat,
    lon: place.lon,
    distanceKm: place.distanceKm,
    address: place.address,
    openingHours: place.openingHours,
    // OpenStreetMap has no delivery data, so these are generated per place.
    prepMinutes: pick(`${place.id}:prep`, [10, 15, 20, 25]),
    deliveryFee: localPrice(region, pick(`${place.id}:fee`, [0, 3, 5, 7, 9])),
    minimumOrder: localPrice(region, cuisine.key === "cafe" ? pick(`${place.id}:min`, [15, 20, 25]) : pick(`${place.id}:min`, [25, 30, 40, 50])),
    pricing,
    halal,
    source: "openstreetmap",
  };
}

// Sample restaurants get an ID per currency because their prices differ.
function samplesFor(location: FoodLocation): Restaurant[] {
  const region = regionFor(location.countryCode);
  const { halal, ...pricing } = pricingFor(location.countryCode);

  return sampleRestaurants.map(({ menu, cuisineKey, ...sample }) => {
    const id = `${sample.id}-${pricing.currency.toLowerCase()}`;
    if (!menus.has(id)) {
      menus.set(id, menu.map((item) => ({ ...item, id: `${id}:${item.id}`, price: localPrice(region, item.price) })));
    }
    const cuisine = cuisineByKey(cuisineKey);
    return {
      ...sample,
      id,
      cuisine: cuisine.label,
      cuisineKey,
      deliveryFee: localPrice(region, sample.deliveryFee),
      minimumOrder: localPrice(region, sample.minimumOrder),
      pricing,
      halal,
      source: "sample" as const,
    };
  });
}

function matchesQuery(restaurant: Restaurant, query: string): boolean {
  const cuisine = cuisineForSearch(query);
  if (cuisine && restaurant.cuisineKey === cuisine.key) return true;

  const needle = query.toLowerCase();
  return restaurant.name.toLowerCase().includes(needle) ||
    restaurant.cuisine.toLowerCase().includes(needle) ||
    Boolean(menus.get(restaurant.id)?.some((item) => item.name.toLowerCase().includes(needle)));
}

export async function searchRestaurants(location: FoodLocation, query?: string) {
  let radiusKm: number | undefined;
  let list: Restaurant[] = [];

  try {
    const nearby = await placesNear(location);
    radiusKm = nearby.radiusKm;
    list = nearby.places.map((place) => fromPlace(place, location));
  } catch (error) {
    console.error(`OpenStreetMap search near ${location.label} failed, using sample restaurants:`,
      error instanceof Error ? error.message : error);
  }

  // "openstreetmap": all real; "mixed": few real places plus samples; "sample": none real.
  const source = !list.length ? "sample" : list.length < FEW_PLACES ? "mixed" : "openstreetmap";
  if (source !== "openstreetmap") list = [...list, ...samplesFor(location)];

  for (const restaurant of list) restaurants.set(restaurant.id, { ...restaurant, countryCode: location.countryCode });

  const { halal: _halal, ...pricing } = pricingFor(location.countryCode);
  const term = query?.trim();
  return {
    source,
    radiusKm,
    pricing,
    restaurants: (term ? list.filter((restaurant) => matchesQuery(restaurant, term)) : list).map(summarize),
  };
}

export async function getMenu(restaurantId: string): Promise<{ restaurant: RestaurantSummary; menu: MenuItem[] } | undefined> {
  const restaurant = restaurants.get(restaurantId);
  if (!restaurant) return undefined;

  let menu = menus.get(restaurantId);
  if (!menu) {
    const region = regionFor(restaurant.countryCode);
    menu = await menuFor(restaurantId, cuisineByKey(restaurant.cuisineKey), {
      halal: restaurant.halal,
      price: (aedAmount) => localPrice(region, aedAmount),
    });
    if (!menu.length) throw new Error("This restaurant's menu isn't available right now");
    menus.set(restaurantId, menu);
  }

  return { restaurant: summarize(restaurant), menu };
}

export async function placeOrder(params: {
  userId: number;
  restaurantId: string;
  location: FoodLocation;
  lines: FoodOrderLine[];
  delivery: FoodDelivery;
}): Promise<FoodOrder> {
  const restaurant = restaurants.get(params.restaurantId);
  if (!restaurant) throw new Error("This restaurant is no longer listed. Please search again.");

  if (restaurant.lat !== undefined && restaurant.lon !== undefined) {
    const distance = distanceKm(params.location, { lat: restaurant.lat, lon: restaurant.lon });
    if (distance > MAX_DELIVERY_KM) {
      throw new Error(`${restaurant.name} is ${distance.toFixed(1)} km away and doesn't deliver that far (max ${MAX_DELIVERY_KM} km)`);
    }
  }

  const menu = menus.get(restaurant.id) ?? (await getMenu(restaurant.id))?.menu ?? [];
  const lines = params.lines.map(({ itemId, quantity }) => {
    const item = menu.find((menuItem) => menuItem.id === itemId);
    if (!item) throw new Error("An item in your cart is no longer available");
    return { name: item.name, quantity, unitPrice: item.price, total: round(item.price * quantity) };
  });
  if (!lines.length) throw new Error("Your cart is empty");

  const { pricing } = restaurant;
  const subtotal = round(lines.reduce((sum, line) => sum + line.total, 0));
  if (subtotal < restaurant.minimumOrder) {
    throw new Error(`The minimum order for ${restaurant.name} is ${pricing.currency} ${restaurant.minimumOrder}`);
  }

  const tax = round((subtotal + restaurant.deliveryFee + pricing.serviceFee) * pricing.taxRate);

  return {
    orderId: `TEST-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    userId: params.userId,
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    location: params.location,
    lines,
    subtotal,
    deliveryFee: restaurant.deliveryFee,
    serviceFee: pricing.serviceFee,
    tax,
    taxLabel: pricing.taxLabel,
    total: round(subtotal + restaurant.deliveryFee + pricing.serviceFee + tax),
    currency: pricing.currency,
    delivery: params.delivery,
    createdAt: Date.now(),
    etaMinutes: summarize(restaurant).etaMinutes,
  };
}

export function orderStatus(order: FoodOrder, now = Date.now()) {
  const elapsed = (now - order.createdAt) / 1000;
  let current = STATUS_TIMELINE[0]!;
  for (const step of STATUS_TIMELINE) {
    if (elapsed >= step.afterSeconds) current = step;
  }
  return { status: current.status, label: current.label };
}
