import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * HealthModule — standalone module for the application health check endpoint.
 *
 * Kept intentionally simple with no service dependencies.
 * Separated from CepModule so the health check is always reachable even if
 * CEP-related infrastructure fails to initialise.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
