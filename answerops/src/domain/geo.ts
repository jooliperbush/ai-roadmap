/**
 * Geography and language.
 *
 * Every run in this system has been US/en since it was built, while the schema carried geo and
 * language on every table. "Are we described differently in Germany?" is a question enterprise
 * buyers ask in the first meeting and it was nearly free to answer.
 *
 * The rule that matters: geos are never pooled. A defect rate in DE and a defect rate in US
 * are two measurements of two populations, exactly like two intent families, and averaging
 * them produces a number that describes nobody.
 */

export interface Market {
  geo: string;
  language: string;
  label: string;
}

export const MARKETS: Market[] = [
  { geo: 'US', language: 'en', label: 'United States, English' },
  { geo: 'GB', language: 'en', label: 'United Kingdom, English' },
  { geo: 'DE', language: 'de', label: 'Germany, German' },
  { geo: 'FR', language: 'fr', label: 'France, French' },
  { geo: 'ES', language: 'es', label: 'Spain, Spanish' },
  { geo: 'JP', language: 'ja', label: 'Japan, Japanese' },
];

export const MARKET_BY_GEO = new Map(MARKETS.map((m) => [m.geo, m]));

export function marketLabel(geo: string, language: string): string {
  return MARKET_BY_GEO.get(geo)?.label ?? `${geo}, ${language}`;
}

export class GeoBlendingError extends Error {
  constructor(geos: string[]) {
    super(
      `Refusing to pool measurements across ${geos.join(', ')}. A rate that spans markets describes none of them; ` +
        'ask for the markets separately.',
    );
    this.name = 'GeoBlendingError';
  }
}

/** The geo counterpart of assertNoBlending(). Same reasoning, different axis. */
export function assertNoGeoBlending(geos: string[]): void {
  const distinct = [...new Set(geos.filter(Boolean))];
  if (distinct.length > 1) throw new GeoBlendingError(distinct);
}

export interface FanoutRequest {
  prompt: string;
  geos: string[];
  languages: string[];
}

export interface FanoutVariant {
  prompt: string;
  geo: string;
  language: string;
}

/**
 * Localised phrasings for the seeded world, so the fan-out is demonstrable without live keys
 * or a translation service. Real deployments supply their own variants per market; these are
 * enough to prove the pipeline keeps markets separate end to end.
 */
export const LOCALISED_PREFIX: Record<string, string> = {
  en: '',
  de: 'Auf Deutsch: ',
  fr: 'En francais: ',
  es: 'En espanol: ',
  ja: 'In Japanese: ',
};

/**
 * One variant per market, capped by budget. Markets are taken in the declared order, so a
 * budget that only affords two markets affords the two the customer listed first.
 */
export function fanout(req: FanoutRequest, maxVariants = Infinity): FanoutVariant[] {
  const out: FanoutVariant[] = [];
  const geos = req.geos.length ? req.geos : ['US'];
  const languages = req.languages.length ? req.languages : ['en'];
  for (const geo of geos) {
    for (const language of languages) {
      if (out.length >= maxVariants) return out;
      // A market pairs a geo with the language actually spoken there when we know it; an
      // explicit pair the customer asked for wins over the table.
      const market = MARKET_BY_GEO.get(geo);
      if (geos.length > 1 && languages.length > 1 && market && market.language !== language) continue;
      out.push({
        prompt: `${LOCALISED_PREFIX[language] ?? ''}${req.prompt}`,
        geo,
        language,
      });
    }
  }
  return out;
}
