import CircuitBreaker from 'opossum';

import { CepProvider } from '../../modules/cep/domain/interfaces/cep-provider.interface';
import { CepResponse } from '../../modules/cep/presentation/schemas/cep-response.schema';

export interface CircuitBreakerOptions {
  errorThresholdPercentage: number;
  resetTimeout: number;
  timeout: number;
  volumeThreshold: number;
}

export class CircuitBreakerCepProvider implements CepProvider {
  readonly name: string;

  private readonly breaker: CircuitBreaker<[string], CepResponse | null>;

  constructor(provider: CepProvider, options: CircuitBreakerOptions) {
    this.name = `CircuitBreaker(${provider.name})`;

    const { timeout, errorThresholdPercentage, resetTimeout, volumeThreshold } =
      options;

    this.breaker = new CircuitBreaker((cep: string) => provider.find(cep), {
      timeout,
      errorThresholdPercentage,
      resetTimeout,
      volumeThreshold,
    });
  }

  find(cep: string): Promise<CepResponse | null> {
    return this.breaker.fire(cep);
  }

  get circuit(): CircuitBreaker<[string], CepResponse | null> {
    return this.breaker;
  }
}
