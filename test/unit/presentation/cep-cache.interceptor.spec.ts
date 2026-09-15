import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { of, throwError, firstValueFrom } from 'rxjs';
import { CepCacheInterceptor } from '../../../src/modules/cep/presentation/interceptors/cep-cache.interceptor';
import { CacheProvider } from '../../../src/shared/cache/cache-provider.interface';
import { CepResponse } from '../../../src/modules/cep/presentation/schemas/cep-response.schema';
import { CepNotFoundException } from '../../../src/shared/errors/cep-not-found.exception';
import { AllProvidersFailedException } from '../../../src/shared/errors/all-providers-failed.exception';

describe('CepCacheInterceptor', () => {
  let interceptor: CepCacheInterceptor;
  let mockCacheProvider: CacheProvider;
  let mockConfigService: { get: ReturnType<typeof vi.fn> };
  let mockResponse: { setHeader: ReturnType<typeof vi.fn> };
  let mockCallHandler: CallHandler;

  const mockCepResponse: CepResponse = {
    cep: '01001000',
    street: 'Praça da Sé',
    complement: 'lado ímpar',
    neighborhood: 'Sé',
    city: 'São Paulo',
    state: 'SP',
    ibge: '3550308',
  };

  const DEFAULT_TTL_MS = 60000;
  const DEFAULT_NEGATIVE_TTL_MS = 10000;

  const createMockContext = (cepParam?: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          params: cepParam !== undefined ? { cep: cepParam } : {},
          url: cepParam !== undefined ? `/cep/${cepParam}` : '/health',
        }),
        getResponse: () => mockResponse,
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    mockCacheProvider = {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
      del: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };

    mockConfigService = {
      get: vi.fn((key: string) => {
        if (key === 'CACHE_TTL_MS') return DEFAULT_TTL_MS;
        if (key === 'CACHE_NEGATIVE_TTL_MS') return DEFAULT_NEGATIVE_TTL_MS;
        return undefined;
      }),
    };

    mockResponse = {
      setHeader: vi.fn(),
    };

    mockCallHandler = {
      handle: vi.fn(),
    };

    const dummyLogger = {
      setContext: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as PinoLogger;

    interceptor = new CepCacheInterceptor(
      mockCacheProvider,
      mockConfigService as unknown as ConfigService<any, true>,
      dummyLogger,
    );
  });

  describe('Cache Hit scenarios', () => {
    it('returns a positive cache hit without calling the handler', async () => {
      vi.mocked(mockCacheProvider.get).mockResolvedValue(mockCepResponse);
      const context = createMockContext('01001000');

      const result$ = await interceptor.intercept(context, mockCallHandler);
      const result = await firstValueFrom(result$);

      expect(result).toEqual(mockCepResponse);
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Cache', 'HIT');
      expect(mockCallHandler.handle).not.toHaveBeenCalled();
      expect(mockCacheProvider.get).toHaveBeenCalledWith('cep:01001000');
    });

    it('returns a negative cache hit as CepNotFoundException', async () => {
      vi.mocked(mockCacheProvider.get).mockResolvedValue({ notFound: true });
      const context = createMockContext('01001000');

      await expect(
        interceptor.intercept(context, mockCallHandler),
      ).rejects.toThrow(CepNotFoundException);
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Cache', 'HIT');
      expect(mockCallHandler.handle).not.toHaveBeenCalled();
      expect(mockCacheProvider.get).toHaveBeenCalledWith('cep:01001000');
    });
  });

  describe('Cache Miss scenarios', () => {
    it('stores successful responses after a cache miss', async () => {
      vi.mocked(mockCacheProvider.get).mockResolvedValue(null);
      vi.mocked(mockCallHandler.handle).mockReturnValue(of(mockCepResponse));
      const context = createMockContext('01001000');

      const result$ = await interceptor.intercept(context, mockCallHandler);
      const result = await firstValueFrom(result$);

      expect(result).toEqual(mockCepResponse);
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Cache', 'MISS');
      expect(mockCallHandler.handle).toHaveBeenCalledTimes(1);
      expect(mockCacheProvider.set).toHaveBeenCalledWith(
        'cep:01001000',
        mockCepResponse,
        DEFAULT_TTL_MS,
      );
    });

    it('stores confirmed 404 responses in the negative cache', async () => {
      vi.mocked(mockCacheProvider.get).mockResolvedValue(null);
      const notFoundException = new CepNotFoundException('01001000');
      vi.mocked(mockCallHandler.handle).mockReturnValue(
        throwError(() => notFoundException),
      );
      const context = createMockContext('01001000');

      const result$ = await interceptor.intercept(context, mockCallHandler);

      await expect(firstValueFrom(result$)).rejects.toThrow(
        CepNotFoundException,
      );

      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Cache', 'MISS');
      expect(mockCallHandler.handle).toHaveBeenCalledTimes(1);
      expect(mockCacheProvider.set).toHaveBeenCalledWith(
        'cep:01001000',
        { notFound: true },
        DEFAULT_NEGATIVE_TTL_MS,
      );
    });

    it('does not cache transient provider failures', async () => {
      vi.mocked(mockCacheProvider.get).mockResolvedValue(null);
      const serverError = new AllProvidersFailedException();
      vi.mocked(mockCallHandler.handle).mockReturnValue(
        throwError(() => serverError),
      );
      const context = createMockContext('01001000');

      const result$ = await interceptor.intercept(context, mockCallHandler);

      await expect(firstValueFrom(result$)).rejects.toThrow(serverError);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Cache', 'MISS');
      expect(mockCallHandler.handle).toHaveBeenCalledTimes(1);
      expect(mockCacheProvider.set).not.toHaveBeenCalled();
    });
  });

  describe('Non-CEP routes bypass', () => {
    it('bypasses non-CEP routes', async () => {
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            params: {},
            url: '/health',
          }),
          getResponse: () => mockResponse,
        }),
      } as unknown as ExecutionContext;
      vi.mocked(mockCallHandler.handle).mockReturnValue(of('health-ok' as any));

      const result$ = await interceptor.intercept(context, mockCallHandler);
      const result = await firstValueFrom(result$);

      expect(result).toBe('health-ok');
      expect(mockCacheProvider.get).not.toHaveBeenCalled();
      expect(mockResponse.setHeader).not.toHaveBeenCalled();
      expect(mockCallHandler.handle).toHaveBeenCalledTimes(1);
    });
  });

  describe('Resilience (non-blocking cache write failures)', () => {
    it('does not fail the request when a cache write fails', async () => {
      vi.mocked(mockCacheProvider.get).mockResolvedValue(null);
      vi.mocked(mockCacheProvider.set).mockRejectedValue(
        new Error('Cache connection refused'),
      );
      vi.mocked(mockCallHandler.handle).mockReturnValue(of(mockCepResponse));
      const context = createMockContext('01001000');

      const result$ = await interceptor.intercept(context, mockCallHandler);
      const result = await firstValueFrom(result$);

      expect(result).toEqual(mockCepResponse);
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Cache', 'MISS');
    });
  });
});
