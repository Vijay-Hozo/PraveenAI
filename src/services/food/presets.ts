// Spots saved in osm-snapshot.json so searches near them answer instantly
// even when Overpass is busy. Any other location still works through live
// lookups; add spots here for places that get searched a lot.
export const SNAPSHOT_SPOTS = [
  { name: "Dubai Marina", lat: 25.0805, lon: 55.1403 },
  { name: "JLT", lat: 25.0700, lon: 55.1440 },
  { name: "Downtown Dubai", lat: 25.1950, lon: 55.2770 },
  { name: "Business Bay", lat: 25.1860, lon: 55.2650 },
  { name: "Deira", lat: 25.2700, lon: 55.3110 },
  { name: "Bur Dubai", lat: 25.2560, lon: 55.2970 },
  { name: "Jumeirah", lat: 25.2150, lon: 55.2550 },
  { name: "Al Barsha", lat: 25.1110, lon: 55.1990 },
  { name: "T. Nagar, Chennai", lat: 13.0418, lon: 80.2341 },
  { name: "Anna Nagar, Chennai", lat: 13.0850, lon: 80.2101 },
  { name: "Adyar, Chennai", lat: 13.0012, lon: 80.2565 },
  { name: "Velachery, Chennai", lat: 12.9791, lon: 80.2209 },
  { name: "Neyveli", lat: 11.5432, lon: 79.4760 },
  { name: "Connaught Place, New Delhi", lat: 28.6315, lon: 77.2167 },
] as const;
