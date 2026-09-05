import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LruCacheProvider } from '../../../src/shared/cache/lru-cache.provider';
import { CACHE_PROVIDER } from '../../../src/shared/cache/cache.constants';
import { envSchema, validate } from '../../../src/shared/config/env.validation';

describe('LruCacheProvider', () => {
  let cacheProvider: LruCacheProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    cacheProvider = new LruCacheProvider();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('get and set', () => {
    it('should return null when getting a non-existent entry', async () => {
      const result = await cacheProvider.get('non-existent-key');
      expect(result).toBeNull();
    });

    it('should return value when getting an existing non-expired entry', async () => {
      const key = 'test-key';
      const value = { data: 'hello world' };
      const ttlMs = 5000;

      await cacheProvider.set(key, value, ttlMs);
      const result = await cacheProvider.get<typeof value>(key);

      expect(result).toEqual(value);
    });

    it('should properly record TTL and expire after the duration', async () => {
      const key = 'ttl-key';
      const value = 'active-value';
      const ttlMs = 1000;

      await cacheProvider.set(key, value, ttlMs);

      // Advance time before expiration
      vi.advanceTimersByTime(500);
      expect(await cacheProvider.get(key)).toBe('active-value');

      // Advance time past expiration
      vi.advanceTimersByTime(501);
      const expiredResult = await cacheProvider.get(key);
      expect(expiredResult).toBeNull();
    });

    it('should return null and delete entry from memory when expired', async () => {
      const key = 'expired-key';
      const value = 12345;
      const ttlMs = 1000;

      await cacheProvider.set(key, value, ttlMs);

      // Advance time past expiration
      vi.advanceTimersByTime(1001);

      const result = await cacheProvider.get(key);
      expect(result).toBeNull();

      // Verify it was deleted from internal store by checking subsequent access
      expect(await cacheProvider.get(key)).toBeNull();
    });

    it('should overwrite existing entry with new value and updated TTL', async () => {
      const key = 'overwrite-key';
      await cacheProvider.set(key, 'initial', 1000);

      vi.advanceTimersByTime(800);

      // Reset with new value and new TTL
      await cacheProvider.set(key, 'updated', 1000);

      // Advance past initial expiration (800 + 300 = 1100 ms total from start)
      vi.advanceTimersByTime(300);

      expect(await cacheProvider.get(key)).toBe('updated');
    });
  });

  describe('LRU eviction policy', () => {
    it('should evict the least recently used item when max capacity is reached', async () => {
      const smallCache = new LruCacheProvider({ max: 2 });

      await smallCache.set('key1', 'val1', 10000);
      await smallCache.set('key2', 'val2', 10000);

      // Access key1 so key2 becomes the least recently used
      await smallCache.get('key1');

      // Add key3, triggering LRU eviction of key2
      await smallCache.set('key3', 'val3', 10000);

      expect(await smallCache.get('key1')).toBe('val1');
      expect(await smallCache.get('key2')).toBeNull(); // evicted!
      expect(await smallCache.get('key3')).toBe('val3');
    });
  });

  describe('del', () => {
    it('should remove the entry from cache', async () => {
      const key = 'delete-key';
      await cacheProvider.set(key, 'some-value', 5000);

      expect(await cacheProvider.get(key)).toBe('some-value');

      await cacheProvider.del(key);

      expect(await cacheProvider.get(key)).toBeNull();
    });

    it('should not fail when deleting a non-existent key', async () => {
      await expect(cacheProvider.del('non-existent')).resolves.not.toThrow();
    });
  });

  describe('clear', () => {
    it('should empty all stored items', async () => {
      await cacheProvider.set('key1', 'val1', 5000);
      await cacheProvider.set('key2', 'val2', 5000);
      await cacheProvider.set('key3', 'val3', 5000);

      expect(await cacheProvider.get('key1')).toBe('val1');
      expect(await cacheProvider.get('key2')).toBe('val2');
      expect(await cacheProvider.get('key3')).toBe('val3');

      await cacheProvider.clear();

      expect(await cacheProvider.get('key1')).toBeNull();
      expect(await cacheProvider.get('key2')).toBeNull();
      expect(await cacheProvider.get('key3')).toBeNull();
    });
  });
});

describe('Cache Infrastructure Tokens', () => {
  it('should define CACHE_PROVIDER token as a symbol', () => {
    expect(CACHE_PROVIDER).toBeDefined();
    expect(typeof CACHE_PROVIDER).toBe('symbol');
    expect(CACHE_PROVIDER.toString()).toBe('Symbol(CACHE_PROVIDER)');
  });

  it('should instantiate LruCacheProvider correctly', () => {
    expect(LruCacheProvider).toBeDefined();
    const instance = new LruCacheProvider();
    expect(instance).toBeInstanceOf(LruCacheProvider);
  });
});

describe('Environment Cache Configuration (envSchema & validate)', () => {
  const baseValidEnv = {
    PORT: '3000',
    CEP_PROVIDER_TIMEOUT_MS: '5000',
    VIACEP_BASE_URL: 'https://viacep.com.br/ws',
    BRASILAPI_BASE_URL: 'https://brasilapi.com.br/api/cep/v1',
  };

  it('should apply default values for CACHE_TTL_MS and CACHE_NEGATIVE_TTL_MS', () => {
    const result = envSchema.parse(baseValidEnv);

    expect(result.CACHE_TTL_MS).toBe(86400000);
    expect(result.CACHE_NEGATIVE_TTL_MS).toBe(600000);
  });

  it('should parse custom valid positive integer strings', () => {
    const customEnv = {
      ...baseValidEnv,
      CACHE_TTL_MS: '3600000',
      CACHE_NEGATIVE_TTL_MS: '300000',
    };

    const result = envSchema.parse(customEnv);

    expect(result.CACHE_TTL_MS).toBe(3600000);
    expect(result.CACHE_NEGATIVE_TTL_MS).toBe(300000);
  });

  it('should fail validation when CACHE_TTL_MS is non-numeric', () => {
    const invalidEnv = {
      ...baseValidEnv,
      CACHE_TTL_MS: 'invalid-ttl',
    };

    const result = envSchema.safeParse(invalidEnv);
    expect(result.success).toBe(false);
  });

  it('should fail validation when CACHE_TTL_MS is non-positive (zero)', () => {
    const invalidEnv = {
      ...baseValidEnv,
      CACHE_TTL_MS: '0',
    };

    const result = envSchema.safeParse(invalidEnv);
    expect(result.success).toBe(false);
  });

  it('should fail validation when CACHE_TTL_MS is negative', () => {
    const invalidEnv = {
      ...baseValidEnv,
      CACHE_TTL_MS: '-5000',
    };

    const result = envSchema.safeParse(invalidEnv);
    expect(result.success).toBe(false);
  });

  it('should fail validation when CACHE_NEGATIVE_TTL_MS is non-numeric', () => {
    const invalidEnv = {
      ...baseValidEnv,
      CACHE_NEGATIVE_TTL_MS: 'abc',
    };

    const result = envSchema.safeParse(invalidEnv);
    expect(result.success).toBe(false);
  });

  it('should fail validation when CACHE_NEGATIVE_TTL_MS is non-positive (zero)', () => {
    const invalidEnv = {
      ...baseValidEnv,
      CACHE_NEGATIVE_TTL_MS: '0',
    };

    const result = envSchema.safeParse(invalidEnv);
    expect(result.success).toBe(false);
  });

  it('should fail validation when CACHE_NEGATIVE_TTL_MS is negative', () => {
    const invalidEnv = {
      ...baseValidEnv,
      CACHE_NEGATIVE_TTL_MS: '-1',
    };

    const result = envSchema.safeParse(invalidEnv);
    expect(result.success).toBe(false);
  });

  it('should throw an error via validate() helper on invalid cache configuration', () => {
    const invalidEnv = {
      ...baseValidEnv,
      CACHE_TTL_MS: 'not-a-number',
    };

    expect(() => validate(invalidEnv)).toThrow(
      /Environment variable validation failed:/,
    );
  });
});
