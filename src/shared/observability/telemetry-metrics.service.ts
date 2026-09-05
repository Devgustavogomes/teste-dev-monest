import { Injectable } from '@nestjs/common';
import { metrics, Counter, UpDownCounter } from '@opentelemetry/api';

export type CepRequestStatus = 'success' | 'fallback' | 'not_found' | 'error';
export type CacheResult = 'hit' | 'miss' | 'negative_hit';
export type CircuitBreakerState = 0 | 1 | 2;

interface RecordableInstrument {
  record?(
    value: number,
    attributes?: Record<string, string | number | undefined>,
  ): void;
}

@Injectable()
export class TelemetryMetricsService {
  private readonly cepRequestsTotal: Counter;
  private readonly cepCacheRequestsTotal: Counter;
  private readonly circuitBreakerState: UpDownCounter;

  constructor() {
    const meter = metrics.getMeter('api-cep');

    this.cepRequestsTotal = meter.createCounter('cep_requests_total', {
      description: 'Tracks CEP lookup attempts by provider and status',
    });

    this.cepCacheRequestsTotal = meter.createCounter(
      'cep_cache_requests_total',
      {
        description: 'Monitors CEP cache efficiency (hit, miss, negative_hit)',
      },
    );

    this.circuitBreakerState = meter.createUpDownCounter(
      'circuit_breaker_state',
      {
        description:
          'Monitors circuit breaker state (0=closed, 1=open, 2=half-open)',
      },
    );
  }

  incrementCepRequests(provider: string, status: CepRequestStatus): void {
    try {
      this.cepRequestsTotal.add(1, { provider, status });
    } catch {
      // Metric operations should not disrupt calling business logic
    }
  }

  incrementCacheRequests(result: CacheResult): void {
    try {
      this.cepCacheRequestsTotal.add(1, { result });
    } catch {
      // Metric operations should not disrupt calling business logic
    }
  }

  setCircuitBreakerState(provider: string, state: CircuitBreakerState): void {
    try {
      const instrument = this
        .circuitBreakerState as unknown as RecordableInstrument;
      if (typeof instrument.record === 'function') {
        instrument.record(state, { provider });
      } else {
        this.circuitBreakerState.add(state, { provider });
      }
    } catch {
      // Metric operations should not disrupt calling business logic
    }
  }
}
