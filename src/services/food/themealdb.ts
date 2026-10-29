// Dish names and photos from TheMealDB (free test key "1"). It has no
// prices, so prices are generated per dish.

import type { Cuisine, MealSource } from "./cuisines";
import { hash, type MenuItem } from "./types";

const API_KEY = process.env.THEMEALDB_API_KEY || "1";
const BASE_URL = `https://www.themealdb.com/api/json/v1/${API_KEY}`;
const CACHE_MS = 24 * 60 * 60 * 1000;

type Meal = { idMeal: string; strMeal: string; strMealThumb?: string };

const cache = new Map<string, { at: number; meals: Promise<Meal[]> }>();

function filter(kind: MealSource["kind"], value: string): Promise<Meal[]> {
  const key = `${kind}:${value}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.meals;

  const param = kind === "area" ? "a" : "c";
  const meals = fetch(`${BASE_URL}/filter.php?${param}=${encodeURIComponent(value)}`, {
    signal: AbortSignal.timeout(10000),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`TheMealDB returned ${response.status}`);
      const data = await response.json() as { meals: Meal[] | null };
      return data.meals ?? [];
    })
    .catch((error) => {
      cache.delete(key);
      throw error;
    });

  cache.set(key, { at: Date.now(), meals });
  return meals;
}

async function mealsFrom(source: MealSource): Promise<Meal[]> {
  const results = await Promise.allSettled(source.values.map((value) => filter(source.kind, value)));
  const byId = new Map<string, Meal>();
  for (const result of results) {
    if (result.status === "fulfilled") for (const meal of result.value) byId.set(meal.idMeal, meal);
  }
  if (!byId.size && results.every((result) => result.status === "rejected")) {
    throw (results[0] as PromiseRejectedResult).reason;
  }
  return [...byId.values()].sort((a, b) => a.idMeal.localeCompare(b.idMeal));
}

// A different slice of the dish list for each restaurant, stable over time.
function slice(meals: Meal[], seed: string, count: number): Meal[] {
  if (meals.length <= count) return meals;
  const start = hash(seed) % meals.length;
  return Array.from({ length: count }, (_, index) => meals[(start + index) % meals.length]!);
}

function toItem(meal: Meal, restaurantId: string, category: string, range: [number, number], veg?: boolean): MenuItem {
  const [min, max] = range;
  return {
    id: `${restaurantId}:${meal.idMeal}`,
    name: meal.strMeal.trim(),
    description: "",
    price: min + (hash(`${restaurantId}:${meal.idMeal}`) % (max - min + 1)),
    category,
    veg,
    image: meal.strMealThumb ? `${meal.strMealThumb}/preview` : undefined,
  };
}

// Dubai restaurants don't serve pork or alcohol, so leave those dishes out.
const NOT_SERVED = /\b(pork|bacon|ham|prosciutto|pancetta|chorizo|salami|pepperoni|carbonara|lard|wine|vin|beer|rum|brandy|whisky|whiskey|vodka|sake)\b/i;
// Sweet dishes TheMealDB doesn't tag as Dessert.
const SWEET = /\b(cakes?|cupcakes?|tarts?|fudge|puddings?|cookies?|brownies?|cheesecake|mousse)\b/i;

export async function menuFor(restaurantId: string, cuisine: Cuisine): Promise<MenuItem[]> {
  const isCafe = cuisine.key === "cafe";

  const [cuisineMeals, desserts] = await Promise.all([
    mealsFrom(cuisine.mains),
    mealsFrom({ kind: "category", values: ["Dessert"] }).catch(() => []),
  ]);
  const dessertIds = new Set(desserts.map((meal) => meal.idMeal));
  const served = (meal: Meal) => !NOT_SERVED.test(meal.strMeal);

  // Area filters return a cuisine's desserts too; list those under Desserts.
  let mains = cuisineMeals.filter((meal) => served(meal) && !dessertIds.has(meal.idMeal) && !SWEET.test(meal.strMeal));
  // Fill thin cuisines (few dishes in TheMealDB) with general mains.
  if (mains.length < 4) {
    mains = [...mains, ...(await mealsFrom({ kind: "category", values: ["Chicken"] }).catch(() => [])).filter(served)];
  }
  const cuisineDesserts = cuisineMeals.filter((meal) => served(meal) && dessertIds.has(meal.idMeal));
  const sweets = (cuisineDesserts.length >= 2 ? cuisineDesserts : desserts).filter(served);

  return [
    ...slice(mains, `${restaurantId}:mains`, isCafe ? 5 : 8)
      .map((meal) => toItem(meal, restaurantId, isCafe ? "Breakfast & brunch" : "Mains", isCafe ? [22, 48] : [28, 75], cuisine.veg)),
    ...slice(sweets, `${restaurantId}:desserts`, isCafe ? 4 : 2)
      .map((meal) => toItem(meal, restaurantId, "Desserts", [16, 36])),
  ];
}
