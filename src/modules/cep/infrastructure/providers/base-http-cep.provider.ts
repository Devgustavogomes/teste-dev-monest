import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { CepProvider } from '../../domain/interfaces/cep-provider.interface';
import { CepResponse } from '../../presentation/schemas/cep-response.schema';
import { Env } from '../../../../shared/config/env.validation';

export interface FetchOptions {
  notFoundOn404?: boolean;
}

export abstract class BaseHttpCepProvider implements CepProvider {
  abstract readonly name: string;

  constructor(
    protected readonly httpService: HttpService,
    protected readonly configService: ConfigService<Env, true>,
    protected readonly logger: PinoLogger,
    contextName?: string,
  ) {
    this.logger.setContext(contextName ?? this.constructor.name);
  }

  protected async fetchWithTelemetry<T>(
    url: string,
    options?: FetchOptions,
  ): Promise<T | null> {
    const timeoutMs = this.configService.get('CEP_PROVIDER_TIMEOUT_MS', {
      infer: true,
    });
    const startTime = performance.now();

    try {
      const response = await firstValueFrom(
        this.httpService.get<T>(url, {
          timeout: timeoutMs,
        }),
      );

      const durationMs = Math.round(performance.now() - startTime);
      this.logger.info({
        provider: this.name,
        url,
        durationMs,
        statusCode: response.status,
      });

      return response.data;
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);
      const statusCode =
        error instanceof AxiosError ? error.response?.status : undefined;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (statusCode && statusCode >= 400 && statusCode < 500) {
        this.logger.warn({
          provider: this.name,
          url,
          durationMs,
          error: errorMessage,
          statusCode,
        });
      } else {
        this.logger.error({
          provider: this.name,
          url,
          durationMs,
          error: errorMessage,
          statusCode,
        });
      }

      if (
        options?.notFoundOn404 &&
        error instanceof AxiosError &&
        error.response?.status === 404
      ) {
        return null;
      }

      throw error;
    }
  }

  abstract find(cep: string): Promise<CepResponse | null>;
}
