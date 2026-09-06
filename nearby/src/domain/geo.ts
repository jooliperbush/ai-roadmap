import type { GeoPoint, MarketCode } from './types.js';

export interface Geocoder {
  geocode(text: string, market: MarketCode): GeoPoint | undefined;
}

/**
 * Tiny static gazetteer so the prototype can place creators who type an area
 * instead of sharing a WhatsApp location pin. Production swaps this for
 * postcodes.io (UK, free) and a Dubai community/area lookup.
 */
const TABLE: Record<MarketCode, Record<string, GeoPoint>> = {
  UK: {
    E1: { lat: 51.517, lng: -0.06 },
    E2: { lat: 51.529, lng: -0.058 },
    E8: { lat: 51.545, lng: -0.062 },
    N1: { lat: 51.537, lng: -0.096 },
    SE1: { lat: 51.503, lng: -0.092 },
    SW9: { lat: 51.465, lng: -0.114 },
    W1: { lat: 51.515, lng: -0.142 },
    WC2: { lat: 51.513, lng: -0.122 },
    M1: { lat: 53.478, lng: -2.236 },
    M4: { lat: 53.485, lng: -2.234 },
    B1: { lat: 52.479, lng: -1.905 },
    shoreditch: { lat: 51.526, lng: -0.078 },
    hackney: { lat: 51.545, lng: -0.055 },
    brixton: { lat: 51.462, lng: -0.115 },
    soho: { lat: 51.513, lng: -0.136 },
    'northern quarter': { lat: 53.484, lng: -2.236 },
  },
  AE: {
    jlt: { lat: 25.07, lng: 55.145 },
    marina: { lat: 25.08, lng: 55.14 },
    'dubai marina': { lat: 25.08, lng: 55.14 },
    jbr: { lat: 25.078, lng: 55.133 },
    downtown: { lat: 25.195, lng: 55.275 },
    'business bay': { lat: 25.186, lng: 55.265 },
    difc: { lat: 25.212, lng: 55.28 },
    jumeirah: { lat: 25.205, lng: 55.24 },
    'al quoz': { lat: 25.14, lng: 55.23 },
    deira: { lat: 25.27, lng: 55.31 },
    karama: { lat: 25.245, lng: 55.303 },
    'city walk': { lat: 25.207, lng: 55.262 },
  },
};

export const staticGeocoder: Geocoder = {
  geocode(text, market) {
    const key = text.trim().toLowerCase();
    const table = TABLE[market];
    if (table[key]) return table[key];
    // UK: try the outward code of a full postcode ("E2 8AA" -> "E2")
    if (market === 'UK') {
      const outward = key.toUpperCase().split(/\s+/)[0]?.replace(/\d[A-Z]{2}$/, '');
      if (outward && table[outward]) return table[outward];
    }
    const hit = Object.keys(table).find((k) => key.includes(k));
    return hit ? table[hit] : undefined;
  },
};
