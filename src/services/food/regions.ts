// Per-country money rules. Generated prices are defined once on a Dubai (AED)
// scale and multiplied by `factor` to land in a believable local range,
// e.g. a AED 42 curry is about ₹190 in India and $15 in the US.

import type { Pricing } from "./types";

type Region = {
  currency: string;
  factor: number;
  // Round prices to this step (₹10, AED 1, $0.5...).
  step: number;
  taxLabel: string;
  taxRate: number;
  halal?: boolean;
};

const EURO: Region = { currency: "EUR", factor: 0.33, step: 0.5, taxLabel: "VAT", taxRate: 0.1 };

const REGIONS: Record<string, Region> = {
  ae: { currency: "AED", factor: 1, step: 1, taxLabel: "VAT", taxRate: 0.05, halal: true },
  sa: { currency: "SAR", factor: 1, step: 1, taxLabel: "VAT", taxRate: 0.15, halal: true },
  qa: { currency: "QAR", factor: 1, step: 1, taxLabel: "Tax", taxRate: 0, halal: true },
  kw: { currency: "KWD", factor: 0.085, step: 0.05, taxLabel: "Tax", taxRate: 0, halal: true },
  bh: { currency: "BHD", factor: 0.1, step: 0.05, taxLabel: "VAT", taxRate: 0.1, halal: true },
  om: { currency: "OMR", factor: 0.1, step: 0.05, taxLabel: "VAT", taxRate: 0.05, halal: true },
  pk: { currency: "PKR", factor: 25, step: 10, taxLabel: "Sales tax", taxRate: 0.16, halal: true },
  in: { currency: "INR", factor: 4.5, step: 10, taxLabel: "GST", taxRate: 0.05 },
  lk: { currency: "LKR", factor: 25, step: 10, taxLabel: "VAT", taxRate: 0.18 },
  bd: { currency: "BDT", factor: 10, step: 10, taxLabel: "VAT", taxRate: 0.05 },
  np: { currency: "NPR", factor: 10, step: 10, taxLabel: "VAT", taxRate: 0.13 },
  sg: { currency: "SGD", factor: 0.45, step: 0.5, taxLabel: "GST", taxRate: 0.09 },
  my: { currency: "MYR", factor: 0.9, step: 0.5, taxLabel: "SST", taxRate: 0.06, halal: true },
  gb: { currency: "GBP", factor: 0.3, step: 0.5, taxLabel: "VAT", taxRate: 0.2 },
  us: { currency: "USD", factor: 0.35, step: 0.5, taxLabel: "Sales tax", taxRate: 0.08 },
  ca: { currency: "CAD", factor: 0.45, step: 0.5, taxLabel: "Tax", taxRate: 0.13 },
  au: { currency: "AUD", factor: 0.5, step: 0.5, taxLabel: "GST", taxRate: 0.1 },
  de: EURO, fr: EURO, it: EURO, es: EURO, nl: EURO, be: EURO, at: EURO, ie: EURO, pt: EURO, gr: EURO, fi: EURO,
};

// Unknown countries get US-dollar prices with no tax.
const FALLBACK: Region = { currency: "USD", factor: 0.35, step: 0.5, taxLabel: "Tax", taxRate: 0 };

export function regionFor(countryCode?: string): Region {
  return REGIONS[countryCode?.toLowerCase() ?? ""] ?? FALLBACK;
}

// Converts an amount on the AED scale to the region's currency.
export function localPrice(region: Region, aedAmount: number): number {
  if (aedAmount === 0) return 0;
  const value = Math.round((aedAmount * region.factor) / region.step) * region.step;
  return Math.max(region.step, Math.round(value * 100) / 100);
}

export function pricingFor(countryCode?: string): Pricing & { halal: boolean } {
  const region = regionFor(countryCode);
  return {
    currency: region.currency,
    serviceFee: localPrice(region, 2),
    taxLabel: region.taxLabel,
    taxRate: region.taxRate,
    halal: Boolean(region.halal),
  };
}
