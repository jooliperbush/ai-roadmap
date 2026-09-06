import Fastify from 'fastify';
import { z } from 'zod';
import { MARKETS } from './domain/markets.js';
import type { Restaurant } from './domain/types.js';
import { Engine } from './services/engine.js';
import { tick } from './services/scheduler.js';
import { newId } from './store/memory.js';
import { CloudApiTransport, parseWebhook, verifySignature, verifyWebhook } from './whatsapp/cloudApi.js';
import { SimulatedTransport } from './whatsapp/simulated.js';
import type { Transport } from './whatsapp/types.js';

const env = process.env;
const transport: Transport =
  env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID
    ? new CloudApiTransport({ token: env.WHATSAPP_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID, appSecret: env.WHATSAPP_APP_SECRET })
    : new SimulatedTransport();

const engine = new Engine(transport, { log: (l) => console.log(`[engine] ${l}`) });
const app = Fastify({ logger: true });

// Keep the raw body so we can verify Meta's signature.
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  try {
    done(null, { raw: body, json: JSON.parse(body as string) });
  } catch (e) {
    done(e as Error);
  }
});

app.get('/health', async () => ({ ok: true, transport: transport instanceof SimulatedTransport ? 'simulated' : 'cloud-api' }));

app.get('/webhooks/whatsapp', async (req, reply) => {
  const challenge = verifyWebhook(req.query as Record<string, unknown>, env.WHATSAPP_VERIFY_TOKEN ?? 'change-me');
  if (challenge === undefined) return reply.code(403).send('forbidden');
  return reply.type('text/plain').send(challenge);
});

app.post('/webhooks/whatsapp', async (req, reply) => {
  const { raw, json } = req.body as { raw: string; json: unknown };
  if (env.WHATSAPP_APP_SECRET && !verifySignature(raw, req.headers['x-hub-signature-256'] as string | undefined, env.WHATSAPP_APP_SECRET)) {
    return reply.code(401).send('bad signature');
  }
  // Meta retries on non-200; acknowledge first, then process.
  reply.code(200).send('ok');
  for (const msg of parseWebhook(json)) {
    engine.handleInbound(msg).catch((e) => app.log.error(e));
  }
});

const RestaurantInput = z.object({
  name: z.string().min(1),
  market: z.enum(['UK', 'AE']),
  lat: z.number(),
  lng: z.number(),
  area: z.string(),
  cuisine: z.array(z.string()).min(1),
  tags: z.array(z.string()).default([]),
  creatorsPerMonth: z.number().int().min(1).max(10).default(5),
  compValueMinor: z.number().int().min(0),
  guests: z.number().int().min(1).max(4).default(2),
  notes: z.string().default(''),
  bookingHours: z.record(z.string(), z.array(z.string().regex(/^\d\d:\d\d$/))),
  contactPhone: z.string().regex(/^\+\d{8,15}$/),
  minFollowers: z.number().int().min(0).default(1000),
});

app.post('/restaurants', async (req, reply) => {
  const parsed = RestaurantInput.safeParse((req.body as { json: unknown }).json);
  if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
  const i = parsed.data;
  const market = MARKETS[i.market];
  const r: Restaurant = {
    id: newId('r'),
    name: i.name,
    market: i.market,
    location: { lat: i.lat, lng: i.lng },
    area: i.area,
    cuisine: i.cuisine,
    tags: i.tags,
    plan: { creatorsPerMonth: i.creatorsPerMonth, priceMinor: market.defaultPriceMinor, currency: market.currency, status: 'active' },
    hospitality: { compValueMinor: i.compValueMinor, guests: i.guests, notes: i.notes },
    bookingHours: i.bookingHours as Restaurant['bookingHours'],
    contactPhone: i.contactPhone,
    minFollowers: i.minFollowers,
    createdAt: new Date().toISOString(),
  };
  engine.store.restaurants.put(r);
  return reply.code(201).send(r);
});

app.post('/scheduler/tick', async () => tick(engine));

app.get('/restaurants/:id/report', async (req, reply) => {
  const { id } = req.params as { id: string };
  const r = engine.store.restaurants.get(id);
  if (!r) return reply.code(404).send('not found');
  const matches = engine.store.matches.find((m) => m.restaurantId === id);
  const bookings = engine.store.bookings.find((b) => b.restaurantId === id);
  const posts = engine.store.posts.find((p) => p.restaurantId === id);
  return { restaurant: r, matches, bookings, posts };
});

const port = Number(env.PORT ?? 3000);
app.listen({ port, host: '0.0.0.0' }).catch((e) => {
  app.log.error(e);
  process.exit(1);
});
