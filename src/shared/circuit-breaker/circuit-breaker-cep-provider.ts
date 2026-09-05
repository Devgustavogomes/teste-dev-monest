import CircuitBreaker from 'opossum';
import { PinoLogger } from 'nestjs-pino';

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

  constructor(
    provider: CepProvider,
    options: CircuitBreakerOptions,
    logger: PinoLogger,
  ) {
    this.name = `CircuitBreaker(${provider.name})`;

    const { timeout, errorThresholdPercentage, resetTimeout, volumeThreshold } =
      options;

    this.breaker = new CircuitBreaker((cep: string) => provider.find(cep), {
      timeout,
      errorThresholdPercentage,
      resetTimeout,
      volumeThreshold,
    });

    this.breaker.on('open', () =>
      logger.warn(
        { provider: provider.name, event: 'open' },
        `Circuit breaker opened for ${provider.name}`,
      ),
    );
    this.breaker.on('close', () =>
      logger.info(
        { provider: provider.name, event: 'close' },
        `Circuit breaker closed for ${provider.name}`,
      ),
    );
    this.breaker.on('halfOpen', () =>
      logger.warn(
        { provider: provider.name, event: 'halfOpen' },
        `Circuit breaker half-open for ${provider.name}`,
      ),
    );
  }

  find(cep: string): Promise<CepResponse | null> {
    return this.breaker.fire(cep);
  }

  get circuit(): CircuitBreaker<[string], CepResponse | null> {
    return this.breaker;
  }
}
