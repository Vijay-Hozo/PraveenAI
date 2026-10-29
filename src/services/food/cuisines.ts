// Maps OpenStreetMap cuisine tags to a display label and to the TheMealDB
// filters used to build that restaurant's menu.

// TheMealDB labels some dishes by nationality ("Indian") and others by
// country ("India"), so each cuisine lists every name that returns dishes.
export type MealSource = { kind: "area" | "category"; values: string[] };

export type Cuisine = {
  key: string;
  label: string;
  emoji: string;
  // OSM cuisine values and search words that mean this cuisine.
  matches: string[];
  mains: MealSource;
  veg?: boolean;
};

const area = (...values: string[]): MealSource => ({ kind: "area", values });
const category = (...values: string[]): MealSource => ({ kind: "category", values });

export const CUISINES: Cuisine[] = [
  {
    key: "indian", label: "Indian", emoji: "🍛", mains: area("Indian", "India"),
    matches: ["indian", "pakistani", "north_indian", "south_indian", "kerala", "biryani", "curry", "nepalese", "sri_lankan", "bangladeshi"],
  },
  {
    key: "arabic", label: "Arabic", emoji: "🌯", mains: area("Turkish", "Syrian", "Saudi Arabia", "Egyptian"),
    matches: ["arab", "arabic", "lebanese", "syrian", "middle_eastern", "emirati", "kebab", "shawarma", "turkish", "persian", "iranian", "egyptian", "oriental", "mandi", "falafel", "grill"],
  },
  {
    key: "chinese", label: "Chinese", emoji: "🥡", mains: area("Chinese", "China"),
    matches: ["chinese", "dim_sum", "cantonese", "noodle", "noodles"],
  },
  {
    key: "japanese", label: "Japanese", emoji: "🍣", mains: area("Japanese", "Japan"),
    matches: ["japanese", "sushi", "ramen"],
  },
  {
    key: "asian", label: "Asian", emoji: "🍜", mains: area("Thai", "Vietnam", "Vietnamese", "Filipino", "Philippines", "Malaysian"),
    matches: ["thai", "vietnamese", "asian", "filipino", "malaysian", "indonesian", "korean", "pan_asian"],
  },
  {
    key: "italian", label: "Italian", emoji: "🍕", mains: area("Italian", "Italy"),
    matches: ["italian", "pizza", "pasta"],
  },
  {
    key: "american", label: "Burgers & American", emoji: "🍔", mains: area("American", "United States"),
    matches: ["burger", "burgers", "american", "steak_house", "chicken", "fried_chicken", "wings", "barbecue", "bbq", "sandwich", "hot_dog", "fast_food", "tex-mex", "new_orleans"],
  },
  {
    key: "mexican", label: "Mexican", emoji: "🌮", mains: area("Mexican", "Mexico"),
    matches: ["mexican", "tacos", "burrito"],
  },
  {
    key: "european", label: "European", emoji: "🥘", mains: area("French", "France", "Greek", "Greece", "Spanish"),
    matches: ["french", "greek", "spanish", "mediterranean", "european", "international", "british", "russian"],
  },
  {
    key: "seafood", label: "Seafood", emoji: "🦞", mains: category("Seafood"),
    matches: ["seafood", "fish", "fish_and_chips"],
  },
  {
    key: "healthy", label: "Healthy", emoji: "🥗", mains: category("Vegetarian", "Vegan"), veg: true,
    matches: ["healthy", "salad", "vegetarian", "vegan", "poke", "juice"],
  },
  {
    key: "cafe", label: "Café", emoji: "☕", mains: category("Breakfast"),
    matches: ["coffee_shop", "coffee", "cafe", "tea", "bakery", "cake", "dessert", "ice_cream", "breakfast", "donut", "crepe"],
  },
];

const FALLBACK: Cuisine = {
  key: "restaurant", label: "Restaurant", emoji: "🍽", mains: category("Chicken", "Beef", "Pasta"), matches: [],
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function cuisineByKey(key: string): Cuisine {
  return CUISINES.find((cuisine) => cuisine.key === key) ?? FALLBACK;
}

// Restaurants without a cuisine tag most likely serve the local food.
const LOCAL_CUISINE: Record<string, string> = {
  in: "indian", pk: "indian", bd: "indian", lk: "indian", np: "indian",
  cn: "chinese", hk: "chinese", tw: "chinese", jp: "japanese",
  th: "asian", vn: "asian", my: "asian", id: "asian", ph: "asian", kr: "asian",
  it: "italian", mx: "mexican", us: "american",
  sa: "arabic", eg: "arabic", jo: "arabic", lb: "arabic", tr: "arabic",
  fr: "european", es: "european", gr: "european",
};

export function localCuisine(key: string, countryCode?: string): Cuisine {
  const local = key === FALLBACK.key ? LOCAL_CUISINE[countryCode?.toLowerCase() ?? ""] : undefined;
  return cuisineByKey(local ?? key);
}

export function cuisineFor(osmCuisine: string | undefined, amenity: string | undefined): Cuisine {
  for (const value of (osmCuisine ?? "").split(";").map(normalize).filter(Boolean)) {
    const match = CUISINES.find((cuisine) => cuisine.matches.includes(value));
    if (match) return match;
  }
  if (amenity === "cafe") return cuisineByKey("cafe");
  if (amenity === "fast_food") return cuisineByKey("american");
  return FALLBACK;
}

// "biryani" -> Indian, "sushi" -> Japanese; undefined for names like "Starbucks".
export function cuisineForSearch(query: string): Cuisine | undefined {
  const value = normalize(query);
  return CUISINES.find((cuisine) =>
    cuisine.label.toLowerCase() === query.trim().toLowerCase() || cuisine.matches.includes(value));
}
