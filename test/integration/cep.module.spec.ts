import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { AxiosError, AxiosResponse } from 'axios';
import { CepModule } from '../../src/modules/cep/cep.module';
import { CEP_PROVIDERS } from '../../src/modules/cep/cep.constants';
import { BuscarCepUseCase } from '../../src/modules/cep/application/use-cases/buscar-cep.use-case';
import { ViaCepProvider } from '../../src/modules/cep/infrastructure/providers/viacep.provider';
import { BrasilApiProvider } from '../../src/modules/cep/infrastructure/providers/brasilapi.provider';
import { CepController } from '../../src/modules/cep/presentation/controllers/cep.controller';
import { CepProvider } from '../../src/modules/cep/domain/interfaces/cep-provider.interface';
import { RoundRobinStrategy } from '../../src/shared/strategies/round-robin.strategy';
import { validate } from '../../src/shared/config/env.validation';
import { CepNotFoundException } from '../../src/shared/errors/cep-not-found.exception';
import { AllProvidersFailedException } from '../../src/shared/errors/all-providers-failed.exception';
import { CACHE_PROVIDER } from '../../src/shared/cache/cache.constants';
import { CacheProvider } from '../../src/shared/cache/cache-provider.interface';
import { LruCacheProvider } from '../../src/shared/cache/lru-cache.provider';
import { CepCacheInterceptor } from '../../src/modules/cep/presentation/interceptors/cep-cache.interceptor';
import { CircuitBreakerCepProvider } from '../../src/shared/circuit-breaker/circuit-breaker-cep-provider';

describe('CepModule (Integration)', () => {
  let moduleRef: TestingModule;
  let useCase: BuscarCepUseCase;
  let viaCepProvider: ViaCepProvider;
  let brasilApiProvider: BrasilApiProvider;
  let providersList: CepProvider[];
  let roundRobinStrategy: RoundRobinStrategy<CepProvider>;
  let controller: CepController;
  let mockHttpService: { get: ReturnType<typeof vi.fn> };

  const mockViaCepSuccessResponse = {
    data: {
      cep: '01001-000',
      logradouro: 'Praça da Sé',
      complemento: 'lado ímpar',
      bairro: 'Sé',
      localidade: 'São Paulo',
      uf: 'SP',
      ibge: '3550308',
    },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as any,
  } as AxiosResponse;

  const mockBrasilApiSuccessResponse = {
    data: {
      cep: '01001-000',
      state: 'SP',
      city: 'São Paulo',
      neighborhood: 'Sé',
      street: 'Praça da Sé',
      service: 'viacep',
    },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as any,
  } as AxiosResponse;

  beforeEach(async () => {
    mockHttpService = {
      get: vi.fn(),
    };

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          validate,
        }),
        CepModule,
      ],
    })
      .overrideProvider(HttpService)
      .useValue(mockHttpService)
      .compile();

    useCase = moduleRef.get<BuscarCepUseCase>(BuscarCepUseCase);
    viaCepProvider = moduleRef.get<ViaCepProvider>(ViaCepProvider);
    brasilApiProvider = moduleRef.get<BrasilApiProvider>(BrasilApiProvider);
    providersList = moduleRef.get<CepProvider[]>(CEP_PROVIDERS);
    roundRobinStrategy =
      moduleRef.get<RoundRobinStrategy<CepProvider>>(RoundRobinStrategy);
    controller = moduleRef.get<CepController>(CepController);
  });

  afterEach(async () => {
    // Shutdown any open opossum circuit breaker timers to prevent test hangs
    if (providersList) {
      for (const provider of providersList) {
        if (provider instanceof CircuitBreakerCepProvider) {
          provider.circuit.shutdown();
        }
      }
    }
    await moduleRef?.close();
  });

  describe('Dependency Injection & Module Wiring', () => {
    it('should correctly resolve BuscarCepUseCase from the module', () => {
      expect(useCase).toBeDefined();
      expect(useCase).toBeInstanceOf(BuscarCepUseCase);
    });

    it('should correctly resolve RoundRobinStrategy from the module', () => {
      expect(roundRobinStrategy).toBeDefined();
      expect(roundRobinStrategy).toBeInstanceOf(RoundRobinStrategy);
    });

    it('should correctly resolve ViaCepProvider and BrasilApiProvider', () => {
      expect(viaCepProvider).toBeDefined();
      expect(viaCepProvider).toBeInstanceOf(ViaCepProvider);
      expect(viaCepProvider.name).toBe('ViaCEP');

      expect(brasilApiProvider).toBeDefined();
      expect(brasilApiProvider).toBeInstanceOf(BrasilApiProvider);
      expect(brasilApiProvider.name).toBe('BrasilAPI');
    });

    it('should correctly resolve CEP_PROVIDERS injection token with both providers wrapped in CircuitBreakerCepProvider', () => {
      expect(providersList).toBeDefined();
      expect(Array.isArray(providersList)).toBe(true);
      expect(providersList).toHaveLength(2);

      // After TASK-003, each provider is wrapped in CircuitBreakerCepProvider
      expect(providersList[0]).toBeInstanceOf(CircuitBreakerCepProvider);
      expect(providersList[1]).toBeInstanceOf(CircuitBreakerCepProvider);

      // The wrapper names encode the original provider names
      expect(providersList[0].name).toContain('ViaCEP');
      expect(providersList[1].name).toContain('BrasilAPI');
    });

    it('should correctly resolve CepController', () => {
      expect(controller).toBeDefined();
      expect(controller).toBeInstanceOf(CepController);
    });

    it('should correctly resolve CACHE_PROVIDER as LruCacheProvider', () => {
      const cacheProvider = moduleRef.get<CacheProvider>(CACHE_PROVIDER);
      expect(cacheProvider).toBeDefined();
      expect(cacheProvider).toBeInstanceOf(LruCacheProvider);
    });

    it('should correctly resolve CepCacheInterceptor', () => {
      const interceptor =
        moduleRef.get<CepCacheInterceptor>(CepCacheInterceptor);
      expect(interceptor).toBeDefined();
      expect(interceptor).toBeInstanceOf(CepCacheInterceptor);
    });
  });

  describe('End-to-End Module Flow (UseCase -> Providers -> HttpService)', () => {
    it('should lookup CEP via ViaCEP on the first call and map response', async () => {
      mockHttpService.get.mockReturnValue(of(mockViaCepSuccessResponse));

      const result = await useCase.execute('01001000');

      expect(mockHttpService.get).toHaveBeenCalledTimes(1);
      expect(mockHttpService.get).toHaveBeenCalledWith(
        'https://viacep.com.br/ws/01001000/json/',
        { timeout: 5000 },
      );
      expect(result).toEqual({
        cep: '01001000',
        street: 'Praça da Sé',
        complement: 'lado ímpar',
        neighborhood: 'Sé',
        city: 'São Paulo',
        state: 'SP',
        ibge: '3550308',
      });
    });

    it('should alternate to BrasilAPI on the second call (Round Robin)', async () => {
      // First call -> ViaCEP
      mockHttpService.get.mockReturnValueOnce(of(mockViaCepSuccessResponse));
      await useCase.execute('01001000');
      expect(mockHttpService.get).toHaveBeenLastCalledWith(
        'https://viacep.com.br/ws/01001000/json/',
        { timeout: 5000 },
      );

      // Second call -> BrasilAPI
      mockHttpService.get.mockReturnValueOnce(of(mockBrasilApiSuccessResponse));
      const result2 = await useCase.execute('01001000');
      expect(mockHttpService.get).toHaveBeenLastCalledWith(
        'https://brasilapi.com.br/api/cep/v1/01001000',
        { timeout: 5000 },
      );
      expect(result2).toEqual({
        cep: '01001000',
        street: 'Praça da Sé',
        complement: '',
        neighborhood: 'Sé',
        city: 'São Paulo',
        state: 'SP',
        ibge: '',
      });
    });

    it('should fallback to BrasilAPI when ViaCEP throws a network error', async () => {
      const networkError = new AxiosError('Network Error', 'ENOTFOUND');

      // Call 1 starts with ViaCEP -> fails, then fallbacks to BrasilAPI -> succeeds
      mockHttpService.get
        .mockReturnValueOnce(throwError(() => networkError))
        .mockReturnValueOnce(of(mockBrasilApiSuccessResponse));

      const result = await useCase.execute('01001000');

      expect(mockHttpService.get).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        cep: '01001000',
        street: 'Praça da Sé',
        complement: '',
        neighborhood: 'Sé',
        city: 'São Paulo',
        state: 'SP',
        ibge: '',
      });
    });

    it('should fallback to BrasilAPI when ViaCEP returns { erro: true } (not found)', async () => {
      const viaCepNotFound = {
        data: { erro: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      } as AxiosResponse;

      mockHttpService.get
        .mockReturnValueOnce(of(viaCepNotFound))
        .mockReturnValueOnce(of(mockBrasilApiSuccessResponse));

      const result = await useCase.execute('01001000');

      expect(mockHttpService.get).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        cep: '01001000',
        street: 'Praça da Sé',
        complement: '',
        neighborhood: 'Sé',
        city: 'São Paulo',
        state: 'SP',
        ibge: '',
      });
    });

    it('should throw CepNotFoundException when both providers indicate not found', async () => {
      const viaCepNotFound = {
        data: { erro: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      } as AxiosResponse;

      const brasilApi404 = new AxiosError(
        'Request failed with status code 404',
        'ERR_BAD_REQUEST',
        undefined,
        undefined,
        { status: 404 } as any,
      );

      mockHttpService.get
        .mockReturnValueOnce(of(viaCepNotFound))
        .mockReturnValueOnce(throwError(() => brasilApi404));

      await expect(useCase.execute('99999999')).rejects.toThrow(
        CepNotFoundException,
      );
      expect(mockHttpService.get).toHaveBeenCalledTimes(2);
    });

    it('should throw AllProvidersFailedException when all providers throw HTTP 500 or network errors', async () => {
      const serverError = new AxiosError(
        'Internal Server Error',
        'ERR_BAD_RESPONSE',
        undefined,
        undefined,
        { status: 500 } as any,
      );

      mockHttpService.get
        .mockReturnValueOnce(throwError(() => serverError))
        .mockReturnValueOnce(throwError(() => serverError));

      await expect(useCase.execute('01001000')).rejects.toThrow(
        AllProvidersFailedException,
      );
      expect(mockHttpService.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('Circuit Breaker Fail-Fast Behavior', () => {
    /**
     * This test group validates that once both circuit breakers are tripped open,
     * the use case rejects with AllProvidersFailedException WITHOUT calling HttpService.
     *
     * Strategy: bootstrap a dedicated module with very low CB thresholds
     * (volumeThreshold=2, errorThresholdPercentage=50) so we can open both circuits
     * with just 2 failed calls each, then verify fail-fast on the next call.
     */

    let cbModuleRef: TestingModule;
    let cbUseCase: BuscarCepUseCase;
    let cbProvidersList: CepProvider[];
    let cbMockHttpService: { get: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
      // Override CB env to minimal thresholds for fast circuit opening
      process.env.CB_VOLUME_THRESHOLD = '2';
      process.env.CB_ERROR_THRESHOLD_PERCENTAGE = '50';
      process.env.CB_RESET_TIMEOUT_MS = '30000';

      cbMockHttpService = { get: vi.fn() };

      cbModuleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            validate,
            ignoreEnvFile: true, // use process.env only
          }),
          CepModule,
        ],
      })
        .overrideProvider(HttpService)
        .useValue(cbMockHttpService)
        .compile();

      cbUseCase = cbModuleRef.get<BuscarCepUseCase>(BuscarCepUseCase);
      cbProvidersList = cbModuleRef.get<CepProvider[]>(CEP_PROVIDERS);
    });

    afterEach(async () => {
      // Shutdown circuit breakers to prevent hanging timers
      if (cbProvidersList) {
        for (const provider of cbProvidersList) {
          if (provider instanceof CircuitBreakerCepProvider) {
            provider.circuit.shutdown();
          }
        }
      }
      await cbModuleRef?.close();

      // Restore env
      delete process.env.CB_VOLUME_THRESHOLD;
      delete process.env.CB_ERROR_THRESHOLD_PERCENTAGE;
      delete process.env.CB_RESET_TIMEOUT_MS;
    });

    it('should reject instantly (fail-fast) without calling HttpService once both circuits are open', async () => {
      const technicalError = new AxiosError(
        'Internal Server Error',
        'ERR_BAD_RESPONSE',
        undefined,
        undefined,
        { status: 500 } as any,
      );

      // Always throw a technical error so the circuit breakers accumulate failures.
      // With volumeThreshold=2 and errorThresholdPercentage=50, each circuit opens
      // after 2 failed calls in the rolling window.
      cbMockHttpService.get.mockReturnValue(
        throwError(() => technicalError),
      );

      // Trip both circuits by sending enough requests so every provider fails.
      // Each call tries all providers in round-robin; we need each circuit to see
      // at least `volumeThreshold` failures. Making 4 attempts is sufficient.
      const warmupAttempts = 4;
      for (let i = 0; i < warmupAttempts; i++) {
        await cbUseCase.execute('01001000').catch(() => {
          /* expected to fail */
        });
      }

      // After tripping, reset the spy call count so we can assert no further HTTP calls are made
      cbMockHttpService.get.mockClear();

      // Now both circuits are open — the next call must fail-fast
      await expect(cbUseCase.execute('01001000')).rejects.toThrow(
        AllProvidersFailedException,
      );

      // Critical assertion: HttpService was NOT called because the open circuits
      // rejected immediately without forwarding to the real providers
      expect(cbMockHttpService.get).not.toHaveBeenCalled();
    });
  });
});
