import { Global, Module } from '@nestjs/common';
import { TelemetryMetricsService } from './telemetry-metrics.service';

@Global()
@Module({
  providers: [TelemetryMetricsService],
  exports: [TelemetryMetricsService],
})
export class ObservabilityModule {}
