import { createHmac, timingSafeEqual } from 'node:crypto';

import type {
  AuthenticatedPrincipal,
  AuthenticationPort,
  UserRole,
} from '../../application/auth/authentication.js';
import { USER_ROLES } from '../../application/auth/authentication.js';
import { AuthenticationError } from '../../shared/errors.js';

type TokenHeader = Readonly<{ alg: 'HS256'; typ: 'JWT' }>;
type TokenPayload = Readonly<{
  sub: string;
  roles: readonly UserRole[];
  exp: number;
}>;

export class SignedBearerTokenAuthenticator implements AuthenticationPort {
  constructor(private readonly secret: string) {
    if (secret.length < 32) {
      throw new Error('AUTH_SECRET must be at least 32 characters');
    }
  }

  authenticate(credential: string): AuthenticatedPrincipal {
    const parts = credential.split('.');
    if (parts.length !== 3) throw new AuthenticationError('Invalid bearer token');

    const encodedHeader = parts[0]!;
    const encodedPayload = parts[1]!;
    const encodedSignature = parts[2]!;
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const expectedSignature = createHmac('sha256', this.secret)
      .update(signingInput)
      .digest();

    let actualSignature: Buffer;
    try {
      actualSignature = Buffer.from(encodedSignature, 'base64url');
    } catch {
      throw new AuthenticationError('Invalid bearer token');
    }

    if (actualSignature.length !== expectedSignature.length ||
        !timingSafeEqual(actualSignature, expectedSignature)) {
      throw new AuthenticationError('Invalid bearer token');
    }

    const header = parseJson<TokenHeader>(encodedHeader);
    const payload = parseJson<TokenPayload>(encodedPayload);

    if (header.alg !== 'HS256' || header.typ !== 'JWT') {
      throw new AuthenticationError('Unsupported bearer token algorithm');
    }

    if (!payload.sub || !Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new AuthenticationError('Bearer token is expired or invalid');
    }

    if (!Array.isArray(payload.roles) ||
        payload.roles.length === 0 ||
        payload.roles.some(role => !USER_ROLES.includes(role))) {
      throw new AuthenticationError('Bearer token roles are invalid');
    }

    return { userId: payload.sub, roles: payload.roles };
  }

  issue(principal: AuthenticatedPrincipal, expiresAt = Math.floor(Date.now() / 1000) + 3600): string {
    const header: TokenHeader = { alg: 'HS256', typ: 'JWT' };
    const payload: TokenPayload = {
      sub: principal.userId,
      roles: principal.roles,
      exp: expiresAt,
    };
    const encodedHeader = encodeJson(header);
    const encodedPayload = encodeJson(payload);
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = createHmac('sha256', this.secret)
      .update(signingInput)
      .digest('base64url');

    return `${signingInput}.${signature}`;
  }
}

export function createAuthenticatorFromEnvironment(): SignedBearerTokenAuthenticator {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is required for authentication');
  return new SignedBearerTokenAuthenticator(secret);
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function parseJson<T>(encoded: string): T {
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T;
  } catch {
    throw new AuthenticationError('Invalid bearer token');
  }
}