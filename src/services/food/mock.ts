// Test-only food ordering provider. No public API lets third parties place
// orders on Talabat, Careem or Deliveroo in Dubai, so this serves fictional
// restaurants and simulates delivery. A real provider can replace it later
// by exporting the same functions.

export const DUBAI_AREAS = [
  "Dubai Marina",
  "JBR",
  "JLT",
  "Downtown Dubai",
  "Business Bay",
  "DIFC",
  "Deira",
  "Bur Dubai",
  "Jumeirah",
  "Al Barsha",
] as const;

export type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  veg?: boolean;
};

type Restaurant = {
  id: string;
  name: string;
  cuisine: string;
  emoji: string;
  rating: number;
  prepMinutes: number;
  deliveryFee: number;
  minimumOrder: number;
  areas: readonly string[];
  menu: MenuItem[];
};

export type RestaurantSummary = Omit<Restaurant, "menu" | "areas"> & {
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

const ALL = DUBAI_AREAS;
const WEST = ["Dubai Marina", "JBR", "JLT", "Al Barsha"];
const CENTRAL = ["Downtown Dubai", "Business Bay", "DIFC", "Jumeirah"];
const OLD_DUBAI = ["Deira", "Bur Dubai", "Downtown Dubai"];

function items(prefix: string, list: Omit<MenuItem, "id">[]): MenuItem[] {
  return list.map((item, index) => ({ id: `${prefix}-${index + 1}`, ...item }));
}

const restaurants: Restaurant[] = [
  {
    id: "r1", name: "Saffron Lane", cuisine: "Indian", emoji: "🍛", rating: 4.6,
    prepMinutes: 20, deliveryFee: 5, minimumOrder: 30, areas: ALL,
    menu: items("r1", [
      { name: "Butter Chicken", description: "Tandoori chicken in a creamy tomato gravy", price: 42, category: "Mains" },
      { name: "Paneer Tikka Masala", description: "Chargrilled paneer, onion and pepper masala", price: 38, category: "Mains", veg: true },
      { name: "Chicken Biryani", description: "Dum-cooked basmati with raita", price: 45, category: "Rice" },
      { name: "Dal Makhani", description: "Slow-cooked black lentils", price: 28, category: "Mains", veg: true },
      { name: "Garlic Naan", description: "", price: 8, category: "Breads", veg: true },
      { name: "Mango Lassi", description: "", price: 14, category: "Drinks", veg: true },
    ]),
  },
  {
    id: "r2", name: "Shawarma Corner", cuisine: "Arabic", emoji: "🌯", rating: 4.5,
    prepMinutes: 10, deliveryFee: 0, minimumOrder: 20, areas: ALL,
    menu: items("r2", [
      { name: "Chicken Shawarma", description: "Garlic toum, pickles, fries inside", price: 12, category: "Shawarma" },
      { name: "Beef Shawarma", description: "Tahini, onion, parsley", price: 14, category: "Shawarma" },
      { name: "Falafel Wrap", description: "Tahini, tomato, pickled turnip", price: 10, category: "Shawarma", veg: true },
      { name: "Mixed Grill Platter", description: "Shish tawook, kebab, lamb tikka, rice", price: 58, category: "Grills" },
      { name: "Hummus", description: "", price: 16, category: "Mezze", veg: true },
      { name: "Fresh Lemon Mint", description: "", price: 12, category: "Drinks", veg: true },
    ]),
  },
  {
    id: "r3", name: "Marina Burger Co.", cuisine: "Burgers", emoji: "🍔", rating: 4.4,
    prepMinutes: 15, deliveryFee: 7, minimumOrder: 35, areas: WEST,
    menu: items("r3", [
      { name: "Classic Smash Burger", description: "Double beef, cheddar, house sauce", price: 39, category: "Burgers" },
      { name: "Crispy Chicken Burger", description: "Buttermilk chicken, slaw, pickles", price: 36, category: "Burgers" },
      { name: "Mushroom Swiss", description: "Beef, sautéed mushrooms, Swiss cheese", price: 42, category: "Burgers" },
      { name: "Truffle Fries", description: "", price: 22, category: "Sides", veg: true },
      { name: "Onion Rings", description: "", price: 18, category: "Sides", veg: true },
      { name: "Salted Caramel Shake", description: "", price: 24, category: "Drinks", veg: true },
    ]),
  },
  {
    id: "r4", name: "Tokyo Table", cuisine: "Japanese", emoji: "🍣", rating: 4.7,
    prepMinutes: 25, deliveryFee: 10, minimumOrder: 60, areas: CENTRAL,
    menu: items("r4", [
      { name: "Salmon Nigiri (4 pcs)", description: "", price: 34, category: "Sushi" },
      { name: "Dragon Roll", description: "Prawn tempura, avocado, eel sauce", price: 52, category: "Sushi" },
      { name: "Avocado Maki", description: "", price: 26, category: "Sushi", veg: true },
      { name: "Chicken Katsu Curry", description: "With Japanese rice", price: 48, category: "Mains" },
      { name: "Spicy Miso Ramen", description: "Pork chashu, egg, nori", price: 55, category: "Mains" },
      { name: "Edamame", description: "Sea salt", price: 18, category: "Sides", veg: true },
    ]),
  },
  {
    id: "r5", name: "Forno Napoli", cuisine: "Italian", emoji: "🍕", rating: 4.5,
    prepMinutes: 18, deliveryFee: 6, minimumOrder: 40, areas: [...WEST, ...CENTRAL],
    menu: items("r5", [
      { name: "Margherita Pizza", description: "San Marzano tomato, fior di latte, basil", price: 45, category: "Pizza", veg: true },
      { name: "Diavola Pizza", description: "Spicy beef pepperoni, chilli oil", price: 55, category: "Pizza" },
      { name: "Truffle Mushroom Pizza", description: "", price: 62, category: "Pizza", veg: true },
      { name: "Penne Arrabbiata", description: "", price: 42, category: "Pasta", veg: true },
      { name: "Chicken Alfredo", description: "", price: 49, category: "Pasta" },
      { name: "Tiramisu", description: "", price: 28, category: "Desserts", veg: true },
    ]),
  },
  {
    id: "r6", name: "Kerala Kitchen", cuisine: "South Indian", emoji: "🥥", rating: 4.6,
    prepMinutes: 20, deliveryFee: 4, minimumOrder: 25, areas: [...OLD_DUBAI, "Al Barsha", "JLT"],
    menu: items("r6", [
      { name: "Masala Dosa", description: "With sambar and chutneys", price: 16, category: "Breakfast", veg: true },
      { name: "Kerala Parotta (2 pcs)", description: "", price: 8, category: "Breads", veg: true },
      { name: "Beef Fry", description: "Coconut slivers, curry leaves", price: 32, category: "Mains" },
      { name: "Fish Moilee", description: "Kingfish in coconut milk", price: 38, category: "Mains" },
      { name: "Chicken 65", description: "", price: 26, category: "Starters" },
      { name: "Sulaimani Tea", description: "", price: 5, category: "Drinks", veg: true },
    ]),
  },
  {
    id: "r7", name: "Green Bowl", cuisine: "Healthy", emoji: "🥗", rating: 4.3,
    prepMinutes: 12, deliveryFee: 5, minimumOrder: 30, areas: ALL,
    menu: items("r7", [
      { name: "Grilled Chicken Quinoa Bowl", description: "Avocado, edamame, sesame dressing", price: 46, category: "Bowls" },
      { name: "Falafel Buddha Bowl", description: "Hummus, greens, pickled onion", price: 39, category: "Bowls", veg: true },
      { name: "Salmon Poke", description: "Sushi rice, mango, ponzu", price: 54, category: "Bowls" },
      { name: "Caesar Salad", description: "", price: 32, category: "Salads" },
      { name: "Acai Bowl", description: "Granola, banana, berries", price: 35, category: "Breakfast", veg: true },
      { name: "Green Detox Juice", description: "", price: 22, category: "Drinks", veg: true },
    ]),
  },
  {
    id: "r8", name: "Al Fanar Grill", cuisine: "Emirati", emoji: "🍢", rating: 4.5,
    prepMinutes: 25, deliveryFee: 8, minimumOrder: 50, areas: [...OLD_DUBAI, "Jumeirah", "DIFC"],
    menu: items("r8", [
      { name: "Chicken Machboos", description: "Spiced rice with loomi", price: 52, category: "Mains" },
      { name: "Lamb Harees", description: "Slow-cooked wheat and lamb", price: 48, category: "Mains" },
      { name: "Grilled Hammour", description: "With rice and daqoos", price: 72, category: "Mains" },
      { name: "Luqaimat", description: "Date syrup, sesame", price: 22, category: "Desserts", veg: true },
      { name: "Karak Chai", description: "", price: 6, category: "Drinks", veg: true },
    ]),
  },
  {
    id: "r9", name: "Wok Street", cuisine: "Chinese", emoji: "🥡", rating: 4.2,
    prepMinutes: 15, deliveryFee: 5, minimumOrder: 30, areas: ALL,
    menu: items("r9", [
      { name: "Kung Pao Chicken", description: "", price: 38, category: "Mains" },
      { name: "Beef in Black Bean Sauce", description: "", price: 42, category: "Mains" },
      { name: "Vegetable Hakka Noodles", description: "", price: 28, category: "Noodles", veg: true },
      { name: "Chicken Fried Rice", description: "", price: 30, category: "Rice" },
      { name: "Dim Sum Basket (6 pcs)", description: "Prawn har gow and chicken siu mai", price: 34, category: "Starters" },
      { name: "Spring Rolls", description: "", price: 18, category: "Starters", veg: true },
    ]),
  },
  {
    id: "r10", name: "Bean & Bake", cuisine: "Café", emoji: "☕", rating: 4.4,
    prepMinutes: 8, deliveryFee: 3, minimumOrder: 20, areas: [...WEST, ...CENTRAL],
    menu: items("r10", [
      { name: "Flat White", description: "", price: 19, category: "Coffee", veg: true },
      { name: "Spanish Latte", description: "", price: 22, category: "Coffee", veg: true },
      { name: "Iced Americano", description: "", price: 17, category: "Coffee", veg: true },
      { name: "Almond Croissant", description: "", price: 18, category: "Bakery", veg: true },
      { name: "Eggs Benedict", description: "Turkey bacon, hollandaise", price: 42, category: "Breakfast" },
      { name: "Avocado Toast", description: "Sourdough, feta, chilli flakes", price: 38, category: "Breakfast", veg: true },
    ]),
  },
];

const byId = new Map(restaurants.map((restaurant) => [restaurant.id, restaurant]));

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// Matches "marina" to "Dubai Marina", "downtown" to "Downtown Dubai", etc.
export function resolveArea(input: string): string | undefined {
  const needle = input.trim().toLowerCase();
  if (!needle) return undefined;
  return DUBAI_AREAS.find((area) => area.toLowerCase() === needle) ??
    DUBAI_AREAS.find((area) => area.toLowerCase().includes(needle) || needle.includes(area.toLowerCase()));
}

function summarize(restaurant: Restaurant): RestaurantSummary {
  const { menu: _menu, areas: _areas, ...summary } = restaurant;
  return { ...summary, etaMinutes: restaurant.prepMinutes + 15 };
}

export async function searchRestaurants(params: { area: string; query?: string }): Promise<RestaurantSummary[]> {
  const query = params.query?.trim().toLowerCase();

  return restaurants
    .filter((restaurant) => restaurant.areas.includes(params.area))
    .filter((restaurant) =>
      !query ||
      restaurant.name.toLowerCase().includes(query) ||
      restaurant.cuisine.toLowerCase().includes(query) ||
      restaurant.menu.some((item) => item.name.toLowerCase().includes(query)))
    .sort((a, b) => b.rating - a.rating)
    .map(summarize);
}

export async function getMenu(restaurantId: string): Promise<{ restaurant: RestaurantSummary; menu: MenuItem[] } | undefined> {
  const restaurant = byId.get(restaurantId);
  return restaurant && { restaurant: summarize(restaurant), menu: restaurant.menu };
}

export async function placeOrder(params: {
  userId: number;
  restaurantId: string;
  area: string;
  lines: FoodOrderLine[];
  delivery: FoodDelivery;
}): Promise<FoodOrder> {
  const restaurant = byId.get(params.restaurantId);
  if (!restaurant) throw new Error("Restaurant not found");
  if (!restaurant.areas.includes(params.area)) throw new Error(`${restaurant.name} doesn't deliver to ${params.area}`);

  const lines = params.lines.map(({ itemId, quantity }) => {
    const item = restaurant.menu.find((menuItem) => menuItem.id === itemId);
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
