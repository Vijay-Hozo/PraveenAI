// Delivery areas with the point restaurants are searched around.
export const DUBAI_AREAS = [
  { name: "Dubai Marina", lat: 25.0805, lon: 55.1403, aliases: ["marina"] },
  { name: "JBR", lat: 25.0780, lon: 55.1335, aliases: ["jumeirah beach residence", "the walk"] },
  { name: "JLT", lat: 25.0700, lon: 55.1440, aliases: ["jumeirah lake towers", "jumeirah lakes towers"] },
  { name: "Downtown Dubai", lat: 25.1950, lon: 55.2770, aliases: ["downtown", "burj khalifa", "dubai mall"] },
  { name: "Business Bay", lat: 25.1860, lon: 55.2650, aliases: [] },
  { name: "DIFC", lat: 25.2115, lon: 55.2810, aliases: ["financial centre", "financial center"] },
  { name: "Deira", lat: 25.2700, lon: 55.3110, aliases: ["al rigga", "rigga", "al ghurair"] },
  { name: "Bur Dubai", lat: 25.2560, lon: 55.2970, aliases: ["karama", "al karama", "mankhool"] },
  { name: "Jumeirah", lat: 25.2150, lon: 55.2550, aliases: ["jumeirah 1", "jumeira", "la mer"] },
  { name: "Al Barsha", lat: 25.1110, lon: 55.1990, aliases: ["barsha", "mall of the emirates", "moe"] },
] as const;

export type DubaiArea = (typeof DUBAI_AREAS)[number];

// Matches "marina" to "Dubai Marina", "Jumeirah Lake Towers" to "JLT", etc.
export function resolveArea(input: string): DubaiArea | undefined {
  const needle = input.trim().toLowerCase();
  if (needle.length < 2) return undefined;

  const names = (area: DubaiArea) => [area.name.toLowerCase(), ...area.aliases];
  // Exact matches first, then the longest name contained in the input, so
  // "Jumeirah Lake Towers" picks JLT rather than Jumeirah.
  return DUBAI_AREAS.find((area) => names(area).includes(needle)) ??
    DUBAI_AREAS
      .flatMap((area) => names(area).map((name) => ({ area, name })))
      .filter(({ name }) => needle.includes(name) || (needle.length >= 4 && name.includes(needle)))
      .sort((a, b) => b.name.length - a.name.length)[0]?.area;
}
