import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PinoLogger } from 'nestjs-pino';
import { FindCepUseCase } from '../../../src/modules/cep/application/use-cases/find-cep.use-case';
import { CepProvider } from '../../../src/modules/cep/domain/interfaces/cep-provider.interface';
import { CepResponse } from '../../../src/modules/cep/presentation/schemas/cep-response.schema';
import { RoundRobinStrategy } from '../../../src/shared/strategies/round-robin.strategy';
import { AllProvidersFailedException } from '../../../src/shared/errors/all-providers-failed.exception';
import { CepNotFoundException } from '../../../src/shared/errors/cep-not-found.exception';
import { ProviderContractException } from '../../../src/shared/errors/provider-contract.exception';
import { TelemetryMetricsService } from '../../../src/shared/observability/telemetry-metrics.service';

describe('FindCepUseCase', () => {
  let provider1: CepProvider;
  let provider2: CepProvider;
  let useCase: FindCepUseCase;

  const sampleCepResponse: CepResponse = {
    cep: '01001000',
    street: 'Praça da Sé',
    complement: 'lado ímpar',
    neighborhood: 'Sé',
    city: 'São Paulo',
    state: 'SP',
    ibge: '3550308',
  };

  const sampleCepResponse2: CepResponse = {
    cep: '01001000',
    street: 'Praça da Sé Provider 2',
    complement: '',
    neighborhood: 'Sé',
    city: 'São Paulo',
    state: 'SP',
    ibge: '3550308',
  };

  let dummyLogger: PinoLogger;
  let dummyTelemetry: TelemetryMetricsService;

  beforeEach(() => {
    provider1 = {
      name: 'Provider1',
      find: vi.fn(),
    };

    provider2 = {
      name: 'Provider2',
      find: vi.fn(),
    };

    dummyLogger = {
      setContext: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as PinoLogger;

    dummyTelemetry = {
      incrementCepRequests: vi.fn(),
      incrementCacheRequests: vi.fn(),
      setCircuitBreakerState: vi.fn(),
    } as unknown as TelemetryMetricsService;

    useCase = new FindCepUseCase(
      new RoundRobinStrategy([provider1, provider2]),
      dummyLogger,
      dummyTelemetry,
    );
  });

  describe('Execution', () => {
    it('should call provider with the given CEP and return result', async () => {
      vi.mocked(provider1.find).mockResolvedValue(sampleCepResponse);

      const result = await useCase.execute('01001000');

      expect(provider1.find).toHaveBeenCalledWith('01001000');
      expect(result).toEqual(sampleCepResponse);
    });
  });

  describe('Round-Robin Distribution', () => {
    it('should alternate between providers on sequential calls', async () => {
      vi.mocked(provider1.find).mockResolvedValue(sampleCepResponse);
      vi.mocked(provider2.find).mockResolvedValue(sampleCepResponse2);

      // Call 1: Should start with provider1
      const res1 = await useCase.execute('01001000');
      expect(provider1.find).toHaveBeenCalledTimes(1);
      expect(provider2.find).toHaveBeenCalledTimes(0);
      expect(res1).toEqual(sampleCepResponse);

      // Call 2: Should start with provider2
      const res2 = await useCase.execute('01001000');
      expect(provider1.find).toHaveBeenCalledTimes(1);
      expect(provider2.find).toHaveBeenCalledTimes(1);
      expect(res2).toEqual(sampleCepResponse2);

      // Call 3: Should wrap around and start with provider1
      const res3 = await useCase.execute('01001000');
      expect(provider1.find).toHaveBeenCalledTimes(2);
      expect(provider2.find).toHaveBeenCalledTimes(1);
      expect(res3).toEqual(sampleCepResponse);
    });
  });

  describe('Fallback behavior', () => {
    it('should fallback to second provider when first provider throws an error', async () => {
      vi.mocked(provider1.find).mockRejectedValue(new Error('Network timeout'));
      vi.mocked(provider2.find).mockResolvedValue(sampleCepResponse2);

      const result = await useCase.execute('01001000');

      expect(provider1.find).toHaveBeenCalledWith('01001000');
      expect(provider2.find).toHaveBeenCalledWith('01001000');
      expect(result).toEqual(sampleCepResponse2);
    });

    it('should fallback to second provider when first provider returns null', async () => {
      vi.mocked(provider1.find).mockResolvedValue(null);
      vi.mocked(provider2.find).mockResolvedValue(sampleCepResponse2);

      const result = await useCase.execute('01001000');

      expect(provider1.find).toHaveBeenCalledWith('01001000');
      expect(provider2.find).toHaveBeenCalledWith('01001000');
      expect(result).toEqual(sampleCepResponse2);
    });
  });

  describe('Contract violation handling', () => {
    it('should log ERROR, increment contract_violation metric, and fallback when provider throws ProviderContractException', async () => {
      const contractError = new ProviderContractException(
        'Provider1',
        [
          {
            code: 'invalid_type',
            expected: 'string',
            received: 'number',
            path: ['cep'],
            message: 'Expected string',
          },
        ],
        { cep: 12345 },
      );

      vi.mocked(provider1.find).mockRejectedValue(contractError);
      vi.mocked(provider2.find).mockResolvedValue(sampleCepResponse2);

      const result = await useCase.execute('01001000');

      expect(result).toEqual(sampleCepResponse2);

      // Verify logger.error was invoked with critical metadata
      expect(dummyLogger.error).toHaveBeenCalledTimes(1);
      expect(dummyLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'Provider1',
          code: 'PROVIDER_CONTRACT_VIOLATION',
          cep: '01001000',
          issues: contractError.issues,
          rawData: contractError.rawData,
        }),
        expect.stringContaining(
          'CRITICAL: Provider Provider1 violated response contract',
        ),
      );

      // Verify telemetry metric was incremented with contract_violation
      expect(dummyTelemetry.incrementCepRequests).toHaveBeenCalledWith(
        'Provider1',
        'contract_violation',
      );
      expect(dummyTelemetry.incrementCepRequests).toHaveBeenCalledWith(
        'Provider2',
        'success',
      );
    });
  });

  describe('Failure scenarios', () => {
    it('should throw CepNotFoundException when all providers return null', async () => {
      vi.mocked(provider1.find).mockResolvedValue(null);
      vi.mocked(provider2.find).mockResolvedValue(null);

      await expect(useCase.execute('99999999')).rejects.toThrow(
        CepNotFoundException,
      );
      expect(provider1.find).toHaveBeenCalledWith('99999999');
      expect(provider2.find).toHaveBeenCalledWith('99999999');
    });

    it('should throw AllProvidersFailedException when all providers throw errors', async () => {
      vi.mocked(provider1.find).mockRejectedValue(
        new Error('Timeout in provider 1'),
      );
      vi.mocked(provider2.find).mockRejectedValue(
        new Error('Connection error in provider 2'),
      );

      await expect(useCase.execute('01001000')).rejects.toThrow(
        AllProvidersFailedException,
      );
      expect(provider1.find).toHaveBeenCalledWith('01001000');
      expect(provider2.find).toHaveBeenCalledWith('01001000');
    });

    it('should throw CepNotFoundException when first provider throws and second returns null', async () => {
      vi.mocked(provider1.find).mockRejectedValue(new Error('Timeout'));
      vi.mocked(provider2.find).mockResolvedValue(null);

      await expect(useCase.execute('01001000')).rejects.toThrow(
        CepNotFoundException,
      );
    });

    it('should throw CepNotFoundException when first provider returns null and second throws', async () => {
      vi.mocked(provider1.find).mockResolvedValue(null);
      vi.mocked(provider2.find).mockRejectedValue(
        new Error('500 Internal Server Error'),
      );

      await expect(useCase.execute('01001000')).rejects.toThrow(
        CepNotFoundException,
      );
    });
  });
});
