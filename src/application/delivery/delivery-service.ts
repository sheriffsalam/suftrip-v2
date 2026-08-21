import {
  DeliveryJob,
  type CreateDeliveryJobInput,
  type DeliveryStatus,
} from '../../domain/delivery/delivery-job.js';
import type { DeliveryJobRepository } from './delivery-job-repository.js';
import { ChangeDeliveryStatus } from './change-delivery-status.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import type { AuthenticatedPrincipal } from '../auth/authentication.js';
import {
  requireDeliveryAccess,
  requireRole,
} from '../auth/authorization.js';

export type CreateDeliveryJobCommand = CreateDeliveryJobInput;

export class DeliveryService {
  private readonly changeStatusUseCase: ChangeDeliveryStatus;

  constructor(private readonly repository: DeliveryJobRepository) {
    this.changeStatusUseCase = new ChangeDeliveryStatus(repository);
  }

  async create(
    principal: AuthenticatedPrincipal,
    command: CreateDeliveryJobCommand,
  ): Promise<ReturnType<DeliveryJob['snapshot']>> {
    requireRole(principal, 'CUSTOMER');

    const authenticatedCommand = {
      ...command,
      requesterId: principal.userId,
    };
    const existing = await this.repository.getById(authenticatedCommand.id);

    if (existing) {
      throw new ConflictError(`DeliveryJob already exists: ${authenticatedCommand.id}`);
    }

    const job = DeliveryJob.create(authenticatedCommand);

    await this.repository.save(job, 0);

    return job.snapshot();
  }

  async get(
    principal: AuthenticatedPrincipal,
    id: string,
  ): Promise<ReturnType<DeliveryJob['snapshot']> | null> {
    const job = await this.repository.getById(id);

    if (job) requireDeliveryAccess(principal, job.snapshot().requesterId);

    return job?.snapshot() ?? null;
  }

  async changeStatus(
    principal: AuthenticatedPrincipal,
    deliveryJobId: string,
    expectedVersion: number,
    nextStatus: DeliveryStatus,
  ): Promise<ReturnType<DeliveryJob['snapshot']>> {
    await this.changeStatusUseCase.execute({
      principal,
      deliveryJobId,
      expectedVersion,
      nextStatus,
    });

    const job = await this.repository.getById(deliveryJobId);

    if (!job) {
      throw new NotFoundError(
        `DeliveryJob not found after update: ${deliveryJobId}`,
      );
    }

    return job.snapshot();
  }
}