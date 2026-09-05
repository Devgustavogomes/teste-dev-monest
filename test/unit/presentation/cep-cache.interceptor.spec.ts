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
    it('Cache Hit 200 sets X-Cache: HIT, returns cached response, and skips handler execution', async () => {
      vi.mocked(mockCacheProvider.get).mockResolvedValue(mockCepResponse);
      const context = createMockContext('01001000');

      const result$ = await interceptor.intercept(context, mockCallHandler);
      const result = await firstValueFrom(result$);

      expect(result).toEqual(mockCepResponse);
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Cache', 'HIT');
      expect(mockCallHandler.handle).not.toHaveBeenCalled();
      expect(mockCacheProvider.get).toHaveBeenCalledWith('cep:01001000');
    });

    it('Negative Cache Hit throws CepNotFoundException with X-Cache: HIT', async () => {
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
    it('Cache Miss 200 sets X-Cache: MISS, calls next.handle(), saves response to cache with CACHE_TTL_MS', async () => {
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

    it('Cache Miss 404 sets X-Cache: MISS, catches CepNotFoundException, saves negative entry ({ notFound: true }) with CACHE_NEGATIVE_TTL_MS, rethrows exception', async () => {
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

    it('Transient error (AllProvidersFailedException 502) sets X-Cache: MISS, does NOT save to cache, rethrows exception', async () => {
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

    it('Generic runtime error sets X-Cache: MISS, does NOT save to cache, rethrows exception', async () => {
      vi.mocked(mockCacheProvider.get).mockResolvedValue(null);
      const genericError = new Error('Unexpected network failure');
      vi.mocked(mockCallHandler.handle).mockReturnValue(
        throwError(() => genericError),
      );
      const context = createMockContext('01001000');

      const result$ = await interceptor.intercept(context, mockCallHandler);

      await expect(firstValueFrom(result$)).rejects.toThrow(genericError);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Cache', 'MISS');
      expect(mockCallHandler.handle).toHaveBeenCalledTimes(1);
      expect(mockCacheProvider.set).not.toHaveBeenCalled();
    });
  });

  describe('Non-CEP routes bypass', () => {
    it('bypasses caching when route is not a CEP lookup (e.g. /health)', async () => {
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
    it('should deliver response normally even if saving to cache fails', async () => {
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
