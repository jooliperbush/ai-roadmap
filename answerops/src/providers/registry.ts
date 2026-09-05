import { SimulatedProvider } from './simulated.js';
import { liveProviders } from './live.js';
import type { ProviderAdapter, SurfaceDescriptor } from './types.js';

export function buildRegistry(): ProviderAdapter[] {
  return [new SimulatedProvider(), ...liveProviders()].filter((adapter) => adapter.available());
}

/**
 * How many real vendor adapters are configured and usable right now.
 *
 * Zero means every sample this deployment takes comes from the deterministic stand-in. The
 * public page promises to ask four assistants, so it has to be able to stop promising that.
 */
export function liveProviderCount(): number {
  return liveProviders().reduce((count, adapter) => count + Number(adapter.available()), 0);
}

export function surfacesFor(
  providers: ProviderAdapter[],
): Array<{ adapter: ProviderAdapter; surface: SurfaceDescriptor }> {
  return providers.flatMap((adapter) => adapter.surfaces.map((surface) => ({ adapter, surface })));
}
