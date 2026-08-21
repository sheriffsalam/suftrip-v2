import type { AuthenticatedPrincipal, UserRole } from './authentication.js';
import { AuthorizationError } from '../../shared/errors.js';

export function requireRole(
  principal: AuthenticatedPrincipal,
  role: UserRole,
): void {
  if (!principal.roles.includes(role)) {
    throw new AuthorizationError();
  }
}

export function canAccessDelivery(
  principal: AuthenticatedPrincipal,
  requesterId: string,
): boolean {
  return principal.roles.includes('ADMIN') ||
    (principal.roles.includes('CUSTOMER') && principal.userId === requesterId);
}

export function requireDeliveryAccess(
  principal: AuthenticatedPrincipal,
  requesterId: string,
): void {
  if (!canAccessDelivery(principal, requesterId)) {
    throw new AuthorizationError();
  }
}

export function requireProviderAccess(
  principal: AuthenticatedPrincipal,
  providerId: string,
): void {
  if (principal.roles.includes('ADMIN')) return;
  if (!principal.roles.includes('PROVIDER') || principal.userId !== providerId) {
    throw new AuthorizationError();
  }
}