// Food ordering for the Mini App (test mode). Restaurants are real places
// from OpenStreetMap and menus are dishes from TheMealDB. No public API can
// place orders with Dubai delivery apps, so prices, fees, ordering and
// delivery are simulated. Fictional sample restaurants are used when
// OpenStreetMap is unavailable.

import { DUBAI_AREAS, resolveArea, type DubaiArea } from "./areas";
import { CUISINES, cuisineByKey, cuisineForSearch } from "./cuisines";
import { restaurantsNear } from "./openstreetmap";
import { sampleRestaurants } from "./sample";
import { menuFor } from "./themealdb";
import type {
  FoodDelivery,
  FoodOrder,
  FoodOrderLine,
  FoodOrderStatus,
  MenuItem,
  Restaurant,
  RestaurantSummary,
} from "./types";

export { resolveArea };
export type { FoodOrder };

export const AREA_NAMES = DUBAI_AREAS.map((area) => area.name);

const CURRENCY = "AED";
const SERVICE_FEE = 2;
const VAT_RATE = 0.05;

// Simulated timeline in seconds after the order, compressed so a test run
// finishes in a couple of minutes.
export const STATUS_TIMELINE: { status: FoodOrderStatus; afterSeconds: number; label: string }[] = [
  { status: "placed", afterSeconds: 0, label: "Order placed" },
  { status: "preparing", afterSeconds: 15, label: "Restaurant is preparing your food" },
  { status: "out_for_delivery", afterSeconds: 60, label: "Rider is on the way" },
  { status: "delivered", afterSeconds: 120, label: "Delivered" },
];

// Every restaurant shown to a user, so menus and orders can look it up by ID.
const restaurants = new Map<string, Restaurant>();
const menus = new Map<string, MenuItem[]>();

for (const { menu, ...restaurant } of sampleRestaurants) {
  restaurants.set(restaurant.id, { ...restaurant, source: "sample" });
  menus.set(restaurant.id, menu);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function summarize(restaurant: Restaurant): RestaurantSummary {
  const { areas: _areas, ...summary } = restaurant;
  return { ...summary, etaMinutes: restaurant.prepMinutes + 15 };
}

function matchesQuery(restaurant: Restaurant, query: string): boolean {
  const cuisine = cuisineForSearch(query);
  if (cuisine && restaurant.cuisine.includes(cuisine.label)) return true;

  const needle = query.toLowerCase();
  return restaurant.name.toLowerCase().includes(needle) ||
    restaurant.cuisine.toLowerCase().includes(needle) ||
    Boolean(menus.get(restaurant.id)?.some((item) => item.name.toLowerCase().includes(needle)));
}

async function loadRestaurants(area: DubaiArea): Promise<{ source: Restaurant["source"]; list: Restaurant[] }> {
  try {
    const list = await restaurantsNear(area.name, area);
    if (list.length) {
      for (const restaurant of list) restaurants.set(restaurant.id, restaurant);
      return { source: "openstreetmap", list };
    }
  } catch (error) {
    console.error(`OpenStreetMap search for ${area.name} failed, using sample restaurants:`, error);
  }

  const list = [...restaurants.values()]
    .filter((restaurant) => restaurant.source === "sample" && restaurant.areas.includes(area.name))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  return { source: "sample", list };
}

export async function searchRestaurants(params: { area: DubaiArea; query?: string }) {
  const { source, list } = await loadRestaurants(params.area);
  const query = params.query?.trim();
  return {
    source,
    restaurants: (query ? list.filter((restaurant) => matchesQuery(restaurant, query)) : list).map(summarize),
  };
}

export async function getMenu(restaurantId: string): Promise<{ restaurant: RestaurantSummary; menu: MenuItem[] } | undefined> {
  const restaurant = restaurants.get(restaurantId);
  if (!restaurant) return undefined;

  let menu = menus.get(restaurantId);
  if (!menu) {
    const cuisine = CUISINES.find((entry) => entry.label === restaurant.cuisine) ?? cuisineByKey("restaurant");
    menu = await menuFor(restaurantId, cuisine);
    if (!menu.length) throw new Error("This restaurant's menu isn't available right now");
    menus.set(restaurantId, menu);
  }

  return { restaurant: summarize(restaurant), menu };
}

export async function placeOrder(params: {
  userId: number;
  restaurantId: string;
  area: string;
  lines: FoodOrderLine[];
  delivery: FoodDelivery;
}): Promise<FoodOrder> {
  const restaurant = restaurants.get(params.restaurantId);
  if (!restaurant) throw new Error("This restaurant is no longer listed. Please search again.");
  if (!restaurant.areas.includes(params.area)) throw new Error(`${restaurant.name} doesn't deliver to ${params.area}`);

  const menu = menus.get(restaurant.id) ?? (await getMenu(restaurant.id))?.menu ?? [];
  const lines = params.lines.map(({ itemId, quantity }) => {
    const item = menu.find((menuItem) => menuItem.id === itemId);
    if (!item) throw new Error("An item in your cart is no longer available");
    return { name: item.name, quantity, unitPrice: item.price, total: round(item.price * quantity) };
  });
  if (!lines.length) throw new Error("Your cart is empty");

  const subtotal = round(lines.reduce((sum, line) => sum + line.total, 0));
  if (subtotal < restaurant.minimumOrder) {
    throw new Error(`The minimum order for ${restaurant.name} is ${CURRENCY} ${restaurant.minimumOrder}`);
  }

  const vat = round((subtotal + restaurant.deliveryFee + SERVICE_FEE) * VAT_RATE);

  return {
    orderId: `TEST-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    userId: params.userId,
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    area: params.area,
    lines,
    subtotal,
    deliveryFee: restaurant.deliveryFee,
    serviceFee: SERVICE_FEE,
    vat,
    total: round(subtotal + restaurant.deliveryFee + SERVICE_FEE + vat),
    currency: CURRENCY,
    delivery: params.delivery,
    createdAt: Date.now(),
    etaMinutes: restaurant.prepMinutes + 15,
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
