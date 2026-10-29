// Fictional restaurants used when OpenStreetMap is unavailable or has no
// places for an area, so the Food tab always has something to order from.

import { DUBAI_AREAS } from "./areas";
import type { MenuItem, Restaurant } from "./types";

type SampleRestaurant = Omit<Restaurant, "source"> & { menu: MenuItem[] };

const ALL = DUBAI_AREAS.map((area) => area.name);
const WEST = ["Dubai Marina", "JBR", "JLT", "Al Barsha"];
const CENTRAL = ["Downtown Dubai", "Business Bay", "DIFC", "Jumeirah"];
const OLD_DUBAI = ["Deira", "Bur Dubai", "Downtown Dubai"];

function items(prefix: string, list: Omit<MenuItem, "id">[]): MenuItem[] {
  return list.map((item, index) => ({ id: `${prefix}-${index + 1}`, ...item }));
}

export const sampleRestaurants: SampleRestaurant[] = [
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
