import { Injectable, Optional } from '@nestjs/common';
import { LRUCache } from 'lru-cache';
import { CacheProvider } from './cache-provider.interface';

export interface LruCacheOptions {
  max?: number;
  ttlAutopurge?: boolean;
}

type NonNullish = object | string | number | boolean | symbol | bigint;

@Injectable()
export class LruCacheProvider implements CacheProvider {
  private readonly cache: LRUCache<string, NonNullish>;

  constructor(@Optional() options?: LruCacheOptions) {
    this.cache = new LRUCache<string, NonNullish>({
      max: options?.max ?? 1000,
      ttlAutopurge: options?.ttlAutopurge ?? false,
      perf: {
        now: () => Date.now(),
      },
    });
  }

  get<T>(key: string): Promise<T | null> {
    const value = this.cache.get(key);

    if (value === undefined) {
      return Promise.resolve(null);
    }

    return Promise.resolve(value as T);
  }

  set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    if (value !== null && value !== undefined) {
      this.cache.set(key, value, { ttl: ttlMs });
    }
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.cache.delete(key);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.cache.clear();
    return Promise.resolve();
  }
}
