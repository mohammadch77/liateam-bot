import 'server-only';
import { getConfig } from '@/lib/config';
import { toAppError, type ErrorCode } from '@/lib/errors';
import { healthRepository } from '@/server/repositories/health.repository';

export type HealthReport = {
  status: 'ok' | 'degraded';
  env: string;
  checks: { database: { status: 'up' | 'down'; latencyMs: number; code?: ErrorCode } };
  time: string;
};

export const healthService = {
  async check(): Promise<HealthReport> {
    const started = performance.now();
    let database: HealthReport['checks']['database'];
    try {
      await healthRepository.ping();
      database = { status: 'up', latencyMs: Math.round(performance.now() - started) };
    } catch (e) {
      database = {
        status: 'down',
        latencyMs: Math.round(performance.now() - started),
        code: toAppError(e).code,
      };
    }
    return {
      status: database.status === 'up' ? 'ok' : 'degraded',
      env: getConfig().APP_ENV,
      checks: { database },
      time: new Date().toISOString(),
    };
  },
};
