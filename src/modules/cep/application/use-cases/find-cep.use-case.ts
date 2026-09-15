import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { CepProvider } from '../../domain/interfaces/cep-provider.interface';
import { CepResponse } from '../../presentation/schemas/cep-response.schema';
import { RoundRobinStrategy } from '../../../../shared/strategies/round-robin.strategy';
import { CepNotFoundException } from '../../../../shared/errors/cep-not-found.exception';
import { AllProvidersFailedException } from '../../../../shared/errors/all-providers-failed.exception';
import { ProviderContractException } from '../../../../shared/errors/provider-contract.exception';
import { TelemetryMetricsService } from '../../../../shared/observability/telemetry-metrics.service';
import { CEP_GLOBAL_TIMEOUT } from '../../cep.constants';

@Injectable()
export class FindCepUseCase {
  constructor(
    private readonly roundRobin: RoundRobinStrategy<CepProvider>,
    private readonly logger: PinoLogger,
    @Inject(CEP_GLOBAL_TIMEOUT) private readonly globalTimeoutMs: number,
    private readonly telemetryMetrics?: TelemetryMetricsService,
  ) {
    this.logger.setContext(FindCepUseCase.name);
  }

  async execute(cep: string): Promise<CepResponse> {
    const signal = AbortSignal.timeout(this.globalTimeoutMs);
    const providers = this.roundRobin.nextSequence();
    let notFoundCount = 0;

    for (const provider of providers) {
      if (signal.aborted) {
        break;
      }

      const startTime = performance.now();
      try {
        const result = await provider.find(cep, signal);

        if (result.status === 'found') {
          this.recordSuccess(provider.name, cep, startTime);
          return result.data;
        }

        this.recordNotFound(provider.name);
        notFoundCount++;
      } catch (error) {
        this.recordFailure(provider.name, cep, error, startTime);

        if (signal.aborted) {
          break;
        }
      }
    }

    if (providers.length > 0 && notFoundCount === providers.length) {
      throw new CepNotFoundException(cep);
    }

    throw new AllProvidersFailedException();
  }

  private recordSuccess(
    providerName: string,
    cep: string,
    startTime: number,
  ): void {
    const durationMs = Math.round(performance.now() - startTime);
    this.telemetryMetrics?.incrementCepRequests(providerName, 'success');
    this.logger.info(
      { provider: providerName, cep, durationMs },
      `Provider ${providerName} succeeded for CEP ${cep} in ${durationMs}ms`,
    );
  }

  private recordNotFound(providerName: string): void {
    this.telemetryMetrics?.incrementCepRequests(providerName, 'not_found');
  }

  private recordFailure(
    providerName: string,
    cep: string,
    error: unknown,
    startTime: number,
  ): void {
    const durationMs = Math.round(performance.now() - startTime);

    if (error instanceof ProviderContractException) {
      this.telemetryMetrics?.incrementCepRequests(
        providerName,
        'contract_violation',
      );
      this.logger.error(
        {
          provider: providerName,
          cep,
          durationMs,
          code: error.code,
          issues: error.issues,
          rawData: error.rawData,
          err: error,
        },
        `CRITICAL: Provider ${providerName} violated response contract for CEP ${cep}`,
      );
      return;
    }

    this.telemetryMetrics?.incrementCepRequests(providerName, 'fallback');
    this.logger.warn(
      {
        provider: providerName,
        cep,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      },
      `Provider ${providerName} failed for CEP ${cep}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
