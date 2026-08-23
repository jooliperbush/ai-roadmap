import { SimulatedProvider } from './simulated.js';
import { liveProviders } from './live.js';
import type { ProviderAdapter, SurfaceDescriptor } from './types.js';

export function buildRegistry(): ProviderAdapter[] {
  const all: ProviderAdapter[] = [new SimulatedProvider(), ...liveProviders()];
  return all.filter((p) => p.available());
}

/**
 * How many real vendor adapters are configured and usable right now.
 *
 * Zero means every sample this deployment takes comes from the deterministic stand-in. The
 * public page promises to ask four assistants, so it has to be able to stop promising that.
 */
export function liveProviderCount(): number {
  return liveProviders().filter((p) => p.available()).length;
}

export function surfacesFor(providers: ProviderAdapter[]): Array<{ adapter: ProviderAdapter; surface: SurfaceDescriptor }> {
  const out: Array<{ adapter: ProviderAdapter; surface: SurfaceDescriptor }> = [];
  for (const adapter of providers) for (const surface of adapter.surfaces) out.push({ adapter, surface });
  return out;
}
