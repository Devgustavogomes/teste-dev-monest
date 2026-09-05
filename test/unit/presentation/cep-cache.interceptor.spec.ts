import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { of, throwError, firstValueFrom } from 'rxjs';
import { CepCacheInterceptor } from '../../../src/modules/cep/presentation/interceptors/cep-cache.interceptor';
import { CacheProvider } from '../../../src/shared/cache/cache-provider.interface';
import { CepNotFoundException } from '../../../src/shared/errors/cep-not-found.exception';
import { AllProvidersFailedException } from '../../../src/shared/errors/all-providers-failed.exception';
import { CepResponse } from '../../../src/modules/cep/presentation/schemas/cep-response.schema';

describe('CepCacheInterceptor', () => {
  let interceptor: CepCacheInterceptor;
  let mockCacheProvider: CacheProvider;
  let mockConfigService: {
    get: ReturnType<typeof vi.fn>;
  };
  let mockResponse: {
    setHeader: ReturnType<typeof vi.fn>;
  };
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

  const DEFAULT_TTL_MS = 86400000;
  const DEFAULT_NEGATIVE_TTL_MS = 600000;

  const createMockContext = (cep?: string): ExecutionContext =>
    ({
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: vi.fn().mockReturnValue({
          params: cep !== undefined ? { cep } : {},
        }),
        getResponse: vi.fn().mockReturnValue(mockResponse),
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

    interceptor = new CepCacheInterceptor(
      mockCacheProvider,
      mockConfigService as unknown as ConfigService<any, true>,
    );
  });

  describe('Cache Hit scenarios', () => {
    it('Cache Hit 200 returns cached CepResponse, sets X-Cache: HIT, does not call next.handle()', async () => {
      vi.mocked(mockCacheProvider.get).mockResolvedValue(mockCepResponse);
      const context = createMockContext('01001000');

      const result$ = await interceptor.intercept(context, mockCallHandler);
      const result = await firstValueFrom(result$);

      expect(result).toEqual(mockCepResponse);
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Cache', 'HIT');
      expect(mockCallHandler.handle).not.toHaveBeenCalled();
      expect(mockCacheProvider.get).toHaveBeenCalledWith('cep:01001000');
    });

    it('Cache Hit 404 throws CepNotFoundException, sets X-Cache: HIT, does not call next.handle()', async () => {
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

      await expect(firstValueFrom(result$)).rejects.toThrow(
        AllProvidersFailedException,
      );

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

      await expect(firstValueFrom(result$)).rejects.toThrow(
        'Unexpected network failure',
      );

      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Cache', 'MISS');
      expect(mockCallHandler.handle).toHaveBeenCalledTimes(1);
      expect(mockCacheProvider.set).not.toHaveBeenCalled();
    });
  });

  describe('Key normalization and caching bypass', () => {
    it('Key normalization normalizes both 01001-000 and 01001000 to key cep:01001000', async () => {
      vi.mocked(mockCacheProvider.get).mockResolvedValue(mockCepResponse);

      // Hyphenated CEP
      const contextHyphen = createMockContext('01001-000');
      const resultHyphen$ = await interceptor.intercept(
        contextHyphen,
        mockCallHandler,
      );
      await firstValueFrom(resultHyphen$);
      expect(mockCacheProvider.get).toHaveBeenCalledWith('cep:01001000');

      // Non-hyphenated CEP
      const contextPlain = createMockContext('01001000');
      const resultPlain$ = await interceptor.intercept(
        contextPlain,
        mockCallHandler,
      );
      await firstValueFrom(resultPlain$);
      expect(mockCacheProvider.get).toHaveBeenLastCalledWith('cep:01001000');
    });

    it('bypasses caching when CEP does not match 8 digits (e.g. 123)', async () => {
      const context = createMockContext('123');
      vi.mocked(mockCallHandler.handle).mockReturnValue(of('bypassed' as any));

      const result$ = await interceptor.intercept(context, mockCallHandler);
      const result = await firstValueFrom(result$);

      expect(result).toBe('bypassed');
      expect(mockCacheProvider.get).not.toHaveBeenCalled();
      expect(mockResponse.setHeader).not.toHaveBeenCalled();
      expect(mockCallHandler.handle).toHaveBeenCalledTimes(1);
    });

    it('bypasses caching when CEP is non-numeric (e.g. abcdefgh)', async () => {
      const context = createMockContext('abcdefgh');
      vi.mocked(mockCallHandler.handle).mockReturnValue(of('bypassed' as any));

      const result$ = await interceptor.intercept(context, mockCallHandler);
      const result = await firstValueFrom(result$);

      expect(result).toBe('bypassed');
      expect(mockCacheProvider.get).not.toHaveBeenCalled();
      expect(mockResponse.setHeader).not.toHaveBeenCalled();
      expect(mockCallHandler.handle).toHaveBeenCalledTimes(1);
    });

    it('bypasses caching when CEP parameter is missing/undefined', async () => {
      const context = createMockContext(undefined);
      vi.mocked(mockCallHandler.handle).mockReturnValue(of('bypassed' as any));

      const result$ = await interceptor.intercept(context, mockCallHandler);
      const result = await firstValueFrom(result$);

      expect(result).toBe('bypassed');
      expect(mockCacheProvider.get).not.toHaveBeenCalled();
      expect(mockResponse.setHeader).not.toHaveBeenCalled();
      expect(mockCallHandler.handle).toHaveBeenCalledTimes(1);
    });
  });
});
