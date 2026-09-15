import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LruCacheProvider } from '../../../src/shared/cache/lru-cache.provider';

describe('LruCacheProvider', () => {
  let cache: LruCacheProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new LruCacheProvider();
  });

  afterEach(() => vi.useRealTimers());

  it('stores values and returns null for missing keys', async () => {
    await cache.set('cep', { city: 'Sao Paulo' }, 1000);

    await expect(cache.get('cep')).resolves.toEqual({ city: 'Sao Paulo' });
    await expect(cache.get('missing')).resolves.toBeNull();
  });

  it('expires values after their TTL', async () => {
    await cache.set('cep', 'value', 1000);

    vi.advanceTimersByTime(999);
    await expect(cache.get('cep')).resolves.toBe('value');

    vi.advanceTimersByTime(2);
    await expect(cache.get('cep')).resolves.toBeNull();
  });

  it('replaces a value and renews its TTL', async () => {
    await cache.set('cep', 'old', 1000);
    vi.advanceTimersByTime(800);
    await cache.set('cep', 'new', 1000);
    vi.advanceTimersByTime(300);

    await expect(cache.get('cep')).resolves.toBe('new');
  });

  it('evicts the least recently used value at capacity', async () => {
    cache = new LruCacheProvider({ max: 2 });
    await cache.set('first', 1, 1000);
    await cache.set('second', 2, 1000);
    await cache.get('first');
    await cache.set('third', 3, 1000);

    await expect(cache.get('first')).resolves.toBe(1);
    await expect(cache.get('second')).resolves.toBeNull();
    await expect(cache.get('third')).resolves.toBe(3);
  });

  it('deletes one value', async () => {
    await cache.set('cep', 'value', 1000);
    await cache.del('cep');

    await expect(cache.get('cep')).resolves.toBeNull();
  });

  it('clears all values', async () => {
    await cache.set('first', 1, 1000);
    await cache.set('second', 2, 1000);
    await cache.clear();

    await expect(cache.get('first')).resolves.toBeNull();
    await expect(cache.get('second')).resolves.toBeNull();
  });
});
