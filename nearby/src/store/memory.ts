import type {
  Booking,
  ConversationState,
  Creator,
  Match,
  Post,
  Restaurant,
} from '../domain/types.js';

/**
 * Minimal persistence contract. The prototype keeps everything in memory; swap for
 * Postgres (one table per entity, same shapes) before onboarding real creators.
 */
export interface Store {
  creators: Repo<Creator>;
  restaurants: Repo<Restaurant>;
  matches: Repo<Match>;
  bookings: Repo<Booking>;
  posts: Repo<Post>;
  conversations: Repo<ConversationState>;
  creatorByPhone(phone: string): Creator | undefined;
  conversationByPhone(phone: string): ConversationState | undefined;
}

export interface Repo<T> {
  get(id: string): T | undefined;
  all(): T[];
  put(item: T): T;
  find(pred: (t: T) => boolean): T[];
}

class MemoryRepo<T> implements Repo<T> {
  private items = new Map<string, T>();
  constructor(private key: (t: T) => string) {}
  get(id: string) {
    return this.items.get(id);
  }
  all() {
    return [...this.items.values()];
  }
  put(item: T) {
    this.items.set(this.key(item), item);
    return item;
  }
  find(pred: (t: T) => boolean) {
    return this.all().filter(pred);
  }
}

export function memoryStore(): Store {
  const creators = new MemoryRepo<Creator>((c) => c.id);
  const conversations = new MemoryRepo<ConversationState>((c) => c.phone);
  return {
    creators,
    restaurants: new MemoryRepo<Restaurant>((r) => r.id),
    matches: new MemoryRepo<Match>((m) => m.id),
    bookings: new MemoryRepo<Booking>((b) => b.id),
    posts: new MemoryRepo<Post>((p) => p.id),
    conversations,
    creatorByPhone: (phone) => creators.find((c) => c.phone === phone)[0],
    conversationByPhone: (phone) => conversations.get(phone),
  };
}

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}
