import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, of, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { CACHE_PROVIDER } from '../../../../shared/cache/cache.constants';
import { CacheProvider } from '../../../../shared/cache/cache-provider.interface';
import { Env } from '../../../../shared/config/env.validation';
import { CepNotFoundException } from '../../../../shared/errors/cep-not-found.exception';

@Injectable()
export class CepCacheInterceptor implements NestInterceptor {
  private readonly cacheTtlMs: number;
  private readonly cacheNegativeTtlMs: number;

  constructor(
    @Inject(CACHE_PROVIDER) private readonly cacheProvider: CacheProvider,
    configService: ConfigService<Env, true>,
  ) {
    this.cacheTtlMs = configService.get('CACHE_TTL_MS', { infer: true });
    this.cacheNegativeTtlMs = configService.get('CACHE_NEGATIVE_TTL_MS', {
      infer: true,
    });
  }

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const normalizedCep = this.extractCep(request);
    if (!normalizedCep) {
      return next.handle();
    }

    const cacheKey = `cep:${normalizedCep}`;
    const cachedValue = await this.cacheProvider.get<unknown>(cacheKey);

    if (cachedValue !== null && cachedValue !== undefined) {
      response.setHeader('X-Cache', 'HIT');

      if (this.isNegativeCache(cachedValue)) {
        throw new CepNotFoundException(normalizedCep);
      }

      return of(cachedValue);
    }

    response.setHeader('X-Cache', 'MISS');

    return next.handle().pipe(
      tap((data) => {
        this.cacheProvider.set(cacheKey, data, this.cacheTtlMs).catch(() => {
      // Falha na gravação do cache não deve interromper a entrega da resposta ao cliente
    });
      }),
      catchError((err: unknown) => {
        if (err instanceof CepNotFoundException) {
          response.setHeader('X-Cache', 'MISS');
          void this.cacheProvider.set(cacheKey, { notFound: true }, this.cacheNegativeTtlMs).catch(() => {
      // Falha na gravação do cache não deve interromper a entrega da resposta ao cliente
    });;
        }
        return throwError(() => err);
      }),
    );
  }

  private extractCep(request: Request): string | null {
    const rawCep = request?.params?.cep;
    if (typeof rawCep !== 'string') {
      return null;
    }

    const digitsOnly = rawCep.replace(/\D/g, '');
    return digitsOnly.length === 8 ? digitsOnly : null;
  }

  private isNegativeCache(value: unknown): boolean {
    return (
      typeof value === 'object' &&
      value !== null &&
      'notFound' in value &&
      (value as Record<string, unknown>).notFound === true
    );
  }

}

