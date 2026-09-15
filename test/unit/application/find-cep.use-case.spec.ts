import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PinoLogger } from 'nestjs-pino';
import { FindCepUseCase } from '../../../src/modules/cep/application/use-cases/find-cep.use-case';
import {
  CepProvider,
  CepProviderResult,
} from '../../../src/modules/cep/domain/interfaces/cep-provider.interface';
import { CepResponse } from '../../../src/modules/cep/presentation/schemas/cep-response.schema';
import { RoundRobinStrategy } from '../../../src/shared/strategies/round-robin.strategy';
import { AllProvidersFailedException } from '../../../src/shared/errors/all-providers-failed.exception';
import { CepNotFoundException } from '../../../src/shared/errors/cep-not-found.exception';
import { ProviderContractException } from '../../../src/shared/errors/provider-contract.exception';
import { TelemetryMetricsService } from '../../../src/shared/observability/telemetry-metrics.service';

const cep: CepResponse = {
  cep: '01001000',
  street: 'Praca da Se',
  complement: '',
  neighborhood: 'Se',
  city: 'Sao Paulo',
  state: 'SP',
  ibge: '3550308',
};
const found: CepProviderResult = { status: 'found', data: cep };
const notFound: CepProviderResult = { status: 'not_found' };

const createProvider = (name: string): CepProvider => ({
  name,
  find: vi.fn(),
});

describe('FindCepUseCase', () => {
  let first: CepProvider;
  let second: CepProvider;
  let logger: PinoLogger;
  let telemetry: TelemetryMetricsService;
  let useCase: FindCepUseCase;

  beforeEach(() => {
    first = createProvider('First');
    second = createProvider('Second');
    logger = {
      setContext: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as PinoLogger;
    telemetry = {
      incrementCepRequests: vi.fn(),
    } as unknown as TelemetryMetricsService;
    useCase = new FindCepUseCase(
      new RoundRobinStrategy([first, second]),
      logger,
      5000,
      telemetry,
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it('returns the first successful result without calling the fallback', async () => {
    vi.mocked(first.find).mockResolvedValue(found);

    await expect(useCase.execute('01001000')).resolves.toEqual(cep);
    expect(second.find).not.toHaveBeenCalled();
  });

  it('uses the same abort signal when falling back after a technical error', async () => {
    vi.mocked(first.find).mockRejectedValue(new Error('network error'));
    vi.mocked(second.find).mockResolvedValue(found);

    await expect(useCase.execute('01001000')).resolves.toEqual(cep);

    const firstSignal = vi.mocked(first.find).mock.calls[0][1];
    const secondSignal = vi.mocked(second.find).mock.calls[0][1];
    expect(firstSignal).toBeInstanceOf(AbortSignal);
    expect(secondSignal).toBe(firstSignal);
  });

  it('falls back after an explicit not_found result', async () => {
    vi.mocked(first.find).mockResolvedValue(notFound);
    vi.mocked(second.find).mockResolvedValue(found);

    await expect(useCase.execute('01001000')).resolves.toEqual(cep);
  });

  it('records contract violations and continues the fallback', async () => {
    const contractError = new ProviderContractException(
      'First',
      [
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'number',
          path: ['cep'],
          message: 'Expected string',
        },
      ],
      { cep: 123 },
    );
    vi.mocked(first.find).mockRejectedValue(contractError);
    vi.mocked(second.find).mockResolvedValue(found);

    await expect(useCase.execute('01001000')).resolves.toEqual(cep);
    expect(telemetry.incrementCepRequests).toHaveBeenCalledWith(
      'First',
      'contract_violation',
    );
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('returns 404 only when every provider confirms not_found', async () => {
    vi.mocked(first.find).mockResolvedValue(notFound);
    vi.mocked(second.find).mockResolvedValue(notFound);

    await expect(useCase.execute('99999999')).rejects.toBeInstanceOf(
      CepNotFoundException,
    );
  });

  it('returns 502 when every provider fails', async () => {
    vi.mocked(first.find).mockRejectedValue(new Error('timeout'));
    vi.mocked(second.find).mockRejectedValue(new Error('network error'));

    await expect(useCase.execute('01001000')).rejects.toBeInstanceOf(
      AllProvidersFailedException,
    );
  });

  it('returns 502 when not_found is mixed with a technical failure', async () => {
    vi.mocked(first.find).mockResolvedValue(notFound);
    vi.mocked(second.find).mockRejectedValue(new Error('timeout'));

    await expect(useCase.execute('01001000')).rejects.toBeInstanceOf(
      AllProvidersFailedException,
    );
  });

  it('stops fallback when the global signal aborts', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    vi.mocked(first.find).mockImplementation(
      (_cep, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true },
          );
        }),
    );

    const execution = useCase.execute('01001000');
    controller.abort();

    await expect(execution).rejects.toBeInstanceOf(AllProvidersFailedException);
    expect(AbortSignal.timeout).toHaveBeenCalledWith(5000);
    expect(second.find).not.toHaveBeenCalled();
  });
});
