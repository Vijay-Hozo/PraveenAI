// A delivery point: a typed place resolved by geocoding or a live location.
export type FoodLocation = {
  lat: number;
  lon: number;
  label: string;
  countryCode?: string;
};

// Local money rules for a location, sent to the app so it can show totals.
export type Pricing = {
  currency: string;
  serviceFee: number;
  taxLabel: string;
  taxRate: number;
};

// A food place found on OpenStreetMap, before local prices are applied.
export type Place = {
  id: string;
  name: string;
  cuisineKey: string;
  lat: number;
  lon: number;
  address?: string;
  openingHours?: string;
};

export type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  veg?: boolean;
  image?: string;
};

export type Restaurant = {
  id: string;
  name: string;
  cuisine: string;
  cuisineKey: string;
  emoji: string;
  rating?: number;
  lat?: number;
  lon?: number;
  distanceKm?: number;
  address?: string;
  openingHours?: string;
  prepMinutes: number;
  deliveryFee: number;
  minimumOrder: number;
  pricing: Pricing;
  // Halal-only regions leave pork and alcohol off generated menus.
  halal: boolean;
  source: "openstreetmap" | "sample";
};

export type RestaurantSummary = Omit<Restaurant, "lat" | "lon" | "halal"> & {
  etaMinutes: number;
};

export type FoodOrderLine = { itemId: string; quantity: number };

export type FoodDelivery = {
  name: string;
  phone: string;
  address: string;
  notes?: string;
};

export type FoodOrderStatus = "placed" | "preparing" | "out_for_delivery" | "delivered";

export type FoodOrder = {
  orderId: string;
  userId: number;
  restaurantId: string;
  restaurantName: string;
  location: FoodLocation;
  lines: { name: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  tax: number;
  taxLabel: string;
  total: number;
  currency: string;
  delivery: FoodDelivery;
  createdAt: number;
  etaMinutes: number;
};

// Stable pseudo-random number from a string, so generated fees and prices
// stay the same for a restaurant or dish across searches and restarts.
export function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pick<T>(seed: string, options: readonly T[]): T {
  return options[hash(seed) % options.length]!;
}

export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
