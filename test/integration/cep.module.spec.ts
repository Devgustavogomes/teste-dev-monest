import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpService } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';
import { AxiosError, AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import { CepModule } from '../../src/modules/cep/cep.module';
import { CEP_PROVIDERS } from '../../src/modules/cep/cep.constants';
import { FindCepUseCase } from '../../src/modules/cep/application/use-cases/find-cep.use-case';
import { CepProvider } from '../../src/modules/cep/domain/interfaces/cep-provider.interface';
import { validate } from '../../src/shared/config/env.validation';
import { AllProvidersFailedException } from '../../src/shared/errors/all-providers-failed.exception';
import { CircuitBreakerCepProvider } from '../../src/shared/circuit-breaker/circuit-breaker-cep-provider';
import { ObservabilityModule } from '../../src/shared/observability/observability.module';

const response = (data: unknown): AxiosResponse =>
  ({
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {},
  }) as AxiosResponse;

const viaCepResponse = response({
  cep: '01001-000',
  logradouro: 'Praca da Se',
  complemento: '',
  bairro: 'Se',
  localidade: 'Sao Paulo',
  uf: 'SP',
  ibge: '3550308',
});

const brasilApiResponse = response({
  cep: '01001-000',
  state: 'SP',
  city: 'Sao Paulo',
  neighborhood: 'Se',
  street: 'Praca da Se',
  service: 'viacep',
});

describe('CepModule integration', () => {
  let moduleRef: TestingModule;
  let useCase: FindCepUseCase;
  let providers: CepProvider[];
  let httpService: { get: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    process.env.CB_VOLUME_THRESHOLD = '2';
    process.env.CB_ERROR_THRESHOLD_PERCENTAGE = '50';
    process.env.CB_RESET_TIMEOUT_MS = '30000';
    httpService = { get: vi.fn() };

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          validate,
          ignoreEnvFile: true,
        }),
        LoggerModule.forRoot({ pinoHttp: { level: 'silent' } }),
        ObservabilityModule,
        CepModule,
      ],
    })
      .overrideProvider(HttpService)
      .useValue(httpService)
      .compile();

    useCase = moduleRef.get<FindCepUseCase>(FindCepUseCase);
    providers = moduleRef.get<CepProvider[]>(CEP_PROVIDERS);
  });

  afterEach(async () => {
    for (const provider of providers) {
      if (provider instanceof CircuitBreakerCepProvider) {
        provider.circuit.shutdown();
      }
    }
    await moduleRef.close();
    delete process.env.CB_VOLUME_THRESHOLD;
    delete process.env.CB_ERROR_THRESHOLD_PERCENTAGE;
    delete process.env.CB_RESET_TIMEOUT_MS;
  });

  it('wires both providers behind round-robin and the shared contract', async () => {
    httpService.get.mockReturnValueOnce(of(viaCepResponse));
    await expect(useCase.execute('01001000')).resolves.toMatchObject({
      cep: '01001000',
      ibge: '3550308',
    });

    httpService.get.mockReturnValueOnce(of(brasilApiResponse));
    await expect(useCase.execute('01001000')).resolves.toMatchObject({
      cep: '01001000',
      ibge: '',
    });

    expect(httpService.get).toHaveBeenNthCalledWith(
      1,
      'https://viacep.com.br/ws/01001000/json/',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(httpService.get).toHaveBeenNthCalledWith(
      2,
      'https://brasilapi.com.br/api/cep/v1/01001000',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('falls back through circuit-breaker-decorated providers', async () => {
    httpService.get
      .mockReturnValueOnce(
        throwError(() => new AxiosError('network error', 'ENOTFOUND')),
      )
      .mockReturnValueOnce(of(brasilApiResponse));

    await expect(useCase.execute('01001000')).resolves.toMatchObject({
      cep: '01001000',
      city: 'Sao Paulo',
    });
    expect(httpService.get).toHaveBeenCalledTimes(2);
  });

  it('stops calling HttpService after both circuits open', async () => {
    const failure = new AxiosError('server error', 'ERR_BAD_RESPONSE');
    httpService.get.mockReturnValue(throwError(() => failure));

    for (let attempt = 0; attempt < 4; attempt++) {
      await useCase.execute('01001000').catch(() => undefined);
    }
    httpService.get.mockClear();

    await expect(useCase.execute('01001000')).rejects.toBeInstanceOf(
      AllProvidersFailedException,
    );
    expect(httpService.get).not.toHaveBeenCalled();
  });
});
