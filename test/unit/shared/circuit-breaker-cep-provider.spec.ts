import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreakerCepProvider } from '../../../src/shared/circuit-breaker/circuit-breaker-cep-provider';
import { CepProvider } from '../../../src/modules/cep/domain/interfaces/cep-provider.interface';
import { CepResponse } from '../../../src/modules/cep/presentation/schemas/cep-response.schema';

const createMockProvider = (): CepProvider => ({
  name: 'MockProvider',
  find: vi.fn(),
});

const TEST_OPTIONS = {
  errorThresholdPercentage: 1,
  resetTimeout: 100,
  timeout: 5000,
  volumeThreshold: 1,
};

const sampleCepResponse: CepResponse = {
  cep: '01001000',
  street: 'Praca da Se',
  complement: 'lado impar',
  neighborhood: 'Se',
  city: 'Sao Paulo',
  state: 'SP',
  ibge: '3550308',
};

describe('CircuitBreakerCepProvider', () => {
  let mockProvider: CepProvider;
  let decorator: CircuitBreakerCepProvider;

  beforeEach(() => {
    mockProvider = createMockProvider();
    decorator = new CircuitBreakerCepProvider(mockProvider, TEST_OPTIONS);
  });

  afterEach(() => {
    decorator.circuit.shutdown();
  });

  describe('Name delegation', () => {
    it('should expose a descriptive name including the wrapped provider name', () => {
      expect(decorator.name).toBe('CircuitBreaker(MockProvider)');
    });
  });

  describe('Circuit getter', () => {
    it('should expose the underlying opossum circuit via the circuit getter', () => {
      expect(decorator.circuit).toBeDefined();
    });
  });

  describe('Closed circuit (normal operation)', () => {
    it('should delegate find() to the wrapped provider and return the result', async () => {
      vi.mocked(mockProvider.find).mockResolvedValue(sampleCepResponse);

      const result = await decorator.find('01001000');

      expect(mockProvider.find).toHaveBeenCalledWith('01001000');
      expect(result).toEqual(sampleCepResponse);
    });

    it('should return null when the wrapped provider returns null (CEP not found)', async () => {
      vi.mocked(mockProvider.find).mockResolvedValue(null);

      const result = await decorator.find('99999999');

      expect(result).toBeNull();
    });
  });

  describe('Null does not count as failure', () => {
    it('should NOT open the circuit after multiple null responses', async () => {
      vi.mocked(mockProvider.find).mockResolvedValue(null);

      // Call more times than volumeThreshold to ensure the circuit evaluates
      for (let i = 0; i < 5; i++) {
        await decorator.find('99999999');
      }

      // Circuit should still be closed - the next call must reach the provider
      vi.mocked(mockProvider.find).mockResolvedValue(sampleCepResponse);
      const result = await decorator.find('01001000');

      expect(result).toEqual(sampleCepResponse);
      // The provider was called all 6 times (5 nulls + 1 success)
      expect(mockProvider.find).toHaveBeenCalledTimes(6);
    });
  });

  describe('Technical errors count as failures', () => {
    it('should open the circuit after error threshold is reached', async () => {
      vi.mocked(mockProvider.find).mockRejectedValue(
        new Error('Network timeout'),
      );

      // Trip the circuit - volumeThreshold is 1, so a single error is enough
      await expect(decorator.find('01001000')).rejects.toThrow();

      // The circuit should now be open; subsequent calls must fail immediately
      // without delegating to the wrapped provider
      const callsBeforeOpen = vi.mocked(mockProvider.find).mock.calls.length;

      await expect(decorator.find('01001000')).rejects.toThrow();

      // The provider should NOT have been called again (opossum short-circuits)
      expect(vi.mocked(mockProvider.find).mock.calls.length).toBe(
        callsBeforeOpen,
      );
    });
  });

  describe('Half-open behavior', () => {
    it('should enter half-open after resetTimeout and allow a test call', async () => {
      // Trip the circuit
      vi.mocked(mockProvider.find).mockRejectedValue(
        new Error('Service unavailable'),
      );
      await expect(decorator.find('01001000')).rejects.toThrow();

      // Wait for resetTimeout (100ms) so the circuit moves to half-open
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Now the provider succeeds - the half-open test call should go through
      vi.mocked(mockProvider.find).mockResolvedValue(sampleCepResponse);
      const result = await decorator.find('01001000');

      expect(result).toEqual(sampleCepResponse);
      expect(mockProvider.find).toHaveBeenCalledTimes(2);
    });
  });
});
