export type ApplicationErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_TRANSITION'
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'PROVIDER_UNAVAILABLE'
  | 'DISPATCH_ASSIGNMENT_CONFLICT'
  | 'PAYMENT_ALREADY_EXISTS'
  | 'PAYMENT_CONCURRENCY_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'PAYMENT_OPERATION_CONFLICT';

export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}

export class ValidationError extends ApplicationError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends ApplicationError {
  constructor(message: string) {
    super('NOT_FOUND', message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends ApplicationError {
  constructor(message: string) {
    super('CONFLICT', message);
    this.name = 'ConflictError';
  }
}

export class InvalidTransitionError extends ApplicationError {
  constructor(message: string) {
    super('INVALID_TRANSITION', message);
    this.name = 'InvalidTransitionError';
  }
}

export class AuthenticationError extends ApplicationError {
  constructor(message = 'Authentication is required') {
    super('AUTHENTICATION_ERROR', message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends ApplicationError {
  constructor(message = 'You are not authorized to perform this operation') {
    super('AUTHORIZATION_ERROR', message);
    this.name = 'AuthorizationError';
  }
}

export class ProviderUnavailableError extends ApplicationError {
  constructor(message = 'No eligible provider is available') {
    super('PROVIDER_UNAVAILABLE', message);
    this.name = 'ProviderUnavailableError';
  }
}

export class DispatchAssignmentConflictError extends ApplicationError {
  constructor(message = 'Dispatch provider assignment conflict') {
    super('DISPATCH_ASSIGNMENT_CONFLICT', message);
    this.name = 'DispatchAssignmentConflictError';
  }
}

export class PaymentAlreadyExistsError extends ApplicationError {
  constructor(message = 'Payment already exists') {
    super('PAYMENT_ALREADY_EXISTS', message);
    this.name = 'PaymentAlreadyExistsError';
  }
}

export class PaymentConcurrencyConflictError extends ApplicationError {
  constructor(message = 'Payment concurrency conflict') {
    super('PAYMENT_CONCURRENCY_CONFLICT', message);
    this.name = 'PaymentConcurrencyConflictError';
  }
}

export class IdempotencyConflictError extends ApplicationError {
  constructor(message = 'Idempotency key has already been used') {
    super('IDEMPOTENCY_CONFLICT', message);
    this.name = 'IdempotencyConflictError';
  }
}

export class PaymentOperationConflictError extends ApplicationError {
  constructor(message = 'Payment operation conflict') {
    super('PAYMENT_OPERATION_CONFLICT', message);
    this.name = 'PaymentOperationConflictError';
  }
}