import { SimulatedProvider } from './simulated.js';
import { liveProviders } from './live.js';
import type { ProviderAdapter, SurfaceDescriptor } from './types.js';

export function buildRegistry(): ProviderAdapter[] {
  const all: ProviderAdapter[] = [new SimulatedProvider(), ...liveProviders()];
  return all.filter((p) => p.available());
}

export function surfacesFor(providers: ProviderAdapter[]): Array<{ adapter: ProviderAdapter; surface: SurfaceDescriptor }> {
  const out: Array<{ adapter: ProviderAdapter; surface: SurfaceDescriptor }> = [];
  for (const adapter of providers) for (const surface of adapter.surfaces) out.push({ adapter, surface });
  return out;
}
