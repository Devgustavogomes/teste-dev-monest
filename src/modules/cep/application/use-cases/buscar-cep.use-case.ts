import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { CepProvider } from '../../domain/interfaces/cep-provider.interface';
import { CepResponse } from '../../presentation/schemas/cep-response.schema';
import { RoundRobinStrategy } from '../../../../shared/strategies/round-robin.strategy';
import { CepNotFoundException } from '../../../../shared/errors/cep-not-found.exception';
import { AllProvidersFailedException } from '../../../../shared/errors/all-providers-failed.exception';

@Injectable()
export class BuscarCepUseCase {
  constructor(
    private readonly roundRobin: RoundRobinStrategy<CepProvider>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(BuscarCepUseCase.name);
  }

  async execute(cep: string): Promise<CepResponse> {
    const providers = this.roundRobin.nextSequence();
    let notFound = false;

    for (const provider of providers) {
      const startTime = performance.now();
      try {
        const result = await provider.find(cep);

        if (result !== null) {
          const durationMs = Math.round(performance.now() - startTime);
          this.logger.info(
            { provider: provider.name, cep, durationMs },
            `Provider ${provider.name} succeeded for CEP ${cep} in ${durationMs}ms`,
          );
          return result;
        }

        notFound = true;
      } catch (error) {
        const durationMs = Math.round(performance.now() - startTime);
        this.logger.warn(
          {
            provider: provider.name,
            cep,
            durationMs,
            error: error instanceof Error ? error.message : String(error),
          },
          `Provider ${provider.name} failed for CEP ${cep}: ${error instanceof Error ? error.message : String(error)}`,
        );
        // Fail fast, try the next provider
      }
    }

    if (notFound) {
      throw new CepNotFoundException(cep);
    }

    throw new AllProvidersFailedException();
  }
}
