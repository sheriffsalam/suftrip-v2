export const USER_ROLES = ['CUSTOMER', 'ADMIN', 'PROVIDER'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export type AuthenticatedPrincipal = Readonly<{
  userId: string;
  roles: readonly UserRole[];
}>;

export interface AuthenticationPort {
  authenticate(credential: string): AuthenticatedPrincipal;
}