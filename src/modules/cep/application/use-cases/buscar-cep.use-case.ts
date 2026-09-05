import { Injectable } from '@nestjs/common';
import { CepProvider } from '../../domain/interfaces/cep-provider.interface';
import { CepResponse } from '../../presentation/schemas/cep-response.schema';
import { RoundRobinStrategy } from '../../../../shared/strategies/round-robin.strategy';
import { CepNotFoundException } from '../../../../shared/errors/cep-not-found.exception';
import { AllProvidersFailedException } from '../../../../shared/errors/all-providers-failed.exception';

@Injectable()
export class BuscarCepUseCase {
  constructor(private readonly roundRobin: RoundRobinStrategy<CepProvider>) {}

  async execute(cep: string): Promise<CepResponse> {
    const providers = this.roundRobin.nextSequence();
    let notFound = false;

    for (const provider of providers) {
      try {
        const result = await provider.find(cep);

        if (result !== null) {
          return result;
        }

        notFound = true;
      } catch {
        // Fail fast, try the next provider
      }
    }

    if (notFound) {
      throw new CepNotFoundException(cep);
    }

    throw new AllProvidersFailedException();
  }
}
