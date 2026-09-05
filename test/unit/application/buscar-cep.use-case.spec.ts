import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PinoLogger } from 'nestjs-pino';
import { BuscarCepUseCase } from '../../../src/modules/cep/application/use-cases/buscar-cep.use-case';
import { CepProvider } from '../../../src/modules/cep/domain/interfaces/cep-provider.interface';
import { CepResponse } from '../../../src/modules/cep/presentation/schemas/cep-response.schema';
import { RoundRobinStrategy } from '../../../src/shared/strategies/round-robin.strategy';
import { AllProvidersFailedException } from '../../../src/shared/errors/all-providers-failed.exception';
import { CepNotFoundException } from '../../../src/shared/errors/cep-not-found.exception';

describe('BuscarCepUseCase', () => {
  let provider1: CepProvider;
  let provider2: CepProvider;
  let useCase: BuscarCepUseCase;

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

  beforeEach(() => {
    provider1 = {
      name: 'Provider1',
      find: vi.fn(),
    };

    provider2 = {
      name: 'Provider2',
      find: vi.fn(),
    };

    const dummyLogger = {
      setContext: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as PinoLogger;

    useCase = new BuscarCepUseCase(
      new RoundRobinStrategy([provider1, provider2]),
      dummyLogger,
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
