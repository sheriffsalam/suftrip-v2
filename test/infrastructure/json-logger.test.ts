import { describe, expect, it } from 'vitest';

import { JsonLogger } from '../../src/infrastructure/observability/json-logger.js';

describe('JsonLogger', () => {
  it('emits structured records without sensitive request data', () => {
    const lines: string[] = [];
    const logger = new JsonLogger(line => lines.push(line));

    logger.info('http.request.completed', {
      requestId: 'request-1',
      method: 'GET',
      path: '/health',
      statusCode: 200,
      durationMs: 1.25,
    });

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
    expect(record).toMatchObject({
      level: 'INFO',
      message: 'http.request.completed',
      context: {
        requestId: 'request-1',
        method: 'GET',
        path: '/health',
        statusCode: 200,
        durationMs: 1.25,
      },
    });
    expect(record).toHaveProperty('timestamp');
    expect(lines[0]).not.toContain('authorization');
    expect(lines[0]).not.toContain('idempotency');
  });

  it('supports warn and error levels', () => {
    const lines: string[] = [];
    const logger = new JsonLogger(line => lines.push(line));

    logger.warn('warning');
    logger.error('failure');

    expect(lines.map(line => (JSON.parse(line) as { level: string }).level)).toEqual(['WARN', 'ERROR']);
  });
});
