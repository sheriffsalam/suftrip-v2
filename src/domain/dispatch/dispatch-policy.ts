import type { DeliveryLocation } from '../delivery/delivery-job.js';
import type { ProviderSnapshot } from './provider.js';

const EARTH_RADIUS_KM = 6371;

export function isEligibleProvider(provider: ProviderSnapshot): boolean {
  return provider.availability === 'AVAILABLE';
}

export function selectNearestProvider(
  pickup: DeliveryLocation,
  providers: readonly ProviderSnapshot[],
): ProviderSnapshot | null {
  return providers
    .filter(isEligibleProvider)
    .map(provider => ({
      provider,
      distance: distanceKm(pickup.latitude, pickup.longitude, provider.location.latitude, provider.location.longitude),
    }))
    .sort((left, right) => left.distance - right.distance || left.provider.id.localeCompare(right.provider.id))[0]?.provider ?? null;
}

export function distanceKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const toRadians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = toRadians(latitudeB - latitudeA);
  const longitudeDelta = toRadians(longitudeB - longitudeA);
  const a = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(latitudeA)) * Math.cos(toRadians(latitudeB)) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}