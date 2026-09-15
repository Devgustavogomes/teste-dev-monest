import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PinoLogger } from 'nestjs-pino';
import { CircuitBreakerCepProvider } from '../../../src/shared/circuit-breaker/circuit-breaker-cep-provider';
import {
  CepProvider,
  CepProviderResult,
} from '../../../src/modules/cep/domain/interfaces/cep-provider.interface';

const found: CepProviderResult = {
  status: 'found',
  data: {
    cep: '01001000',
    street: 'Praca da Se',
    complement: '',
    neighborhood: 'Se',
    city: 'Sao Paulo',
    state: 'SP',
    ibge: '3550308',
  },
};
const notFound: CepProviderResult = { status: 'not_found' };

describe('CircuitBreakerCepProvider', () => {
  let inner: CepProvider;
  let provider: CircuitBreakerCepProvider;

  beforeEach(() => {
    inner = { name: 'MockProvider', find: vi.fn() };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    } as unknown as PinoLogger;
    provider = new CircuitBreakerCepProvider(
      inner,
      {
        errorThresholdPercentage: 1,
        resetTimeout: 100,
        timeout: 5000,
        volumeThreshold: 1,
      },
      logger,
    );
  });

  afterEach(() => provider.circuit.shutdown());

  it('delegates the result and abort signal', async () => {
    const controller = new AbortController();
    vi.mocked(inner.find).mockResolvedValue(found);

    await expect(provider.find('01001000', controller.signal)).resolves.toEqual(
      found,
    );
    expect(inner.find).toHaveBeenCalledWith('01001000', controller.signal);
  });

  it('does not open the circuit for not_found results', async () => {
    vi.mocked(inner.find).mockResolvedValue(notFound);

    for (let attempt = 0; attempt < 5; attempt++) {
      await provider.find('99999999');
    }

    vi.mocked(inner.find).mockResolvedValue(found);
    await expect(provider.find('01001000')).resolves.toEqual(found);
    expect(inner.find).toHaveBeenCalledTimes(6);
  });

  it('opens the circuit after a technical failure reaches the threshold', async () => {
    vi.mocked(inner.find).mockRejectedValue(new Error('network error'));

    await expect(provider.find('01001000')).rejects.toThrow();
    await expect(provider.find('01001000')).rejects.toThrow();

    expect(inner.find).toHaveBeenCalledOnce();
  });

  it('allows a probe after entering half-open state', async () => {
    vi.mocked(inner.find).mockRejectedValue(new Error('unavailable'));
    await expect(provider.find('01001000')).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 150));

    vi.mocked(inner.find).mockResolvedValue(found);

    await expect(provider.find('01001000')).resolves.toEqual(found);
    expect(inner.find).toHaveBeenCalledTimes(2);
  });
});
