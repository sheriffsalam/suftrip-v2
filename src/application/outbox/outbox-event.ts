export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'DEAD_LETTER';

export type OutboxEvent = Readonly<{
  id: string;
  aggregateId: string;
  type: string;
  payload: Readonly<Record<string, unknown>>;
  status: OutboxStatus;
  attempts: number;
  availableAt: string;
  claimedBy: string | null;
  claimUntil: string | null;
  lastError: string | null;
  createdAt: string;
  publishedAt: string | null;
}>;

export type NewOutboxEvent = Readonly<{
  id: string;
  aggregateId: string;
  type: string;
  payload: Readonly<Record<string, unknown>>;
}>;
