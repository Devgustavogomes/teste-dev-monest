export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface CacheProvider {
  get<T>(key: string): Promise<T | null>;

  set<T>(key: string, value: T, ttlMs: number): Promise<void>;

  del(key: string): Promise<void>;

  clear?(): Promise<void>;
}
