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
  emoji: string;
  rating?: number;
  distanceKm?: number;
  address?: string;
  openingHours?: string;
  prepMinutes: number;
  deliveryFee: number;
  minimumOrder: number;
  areas: readonly string[];
  source: "openstreetmap" | "sample";
};

export type RestaurantSummary = Omit<Restaurant, "areas"> & {
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
  area: string;
  lines: { name: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  vat: number;
  total: number;
  currency: "AED";
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
