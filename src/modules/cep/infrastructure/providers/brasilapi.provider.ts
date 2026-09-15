import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { Env } from '../../../../shared/config/env.validation';
import { CepProviderResult } from '../../domain/interfaces/cep-provider.interface';
import { BaseHttpCepProvider } from './base-http-cep.provider';
import {
  brasilApiResponseSchema,
  BrasilApiResponse,
} from './schemas/brasilapi-response.schema';

export { brasilApiResponseSchema, BrasilApiResponse };

@Injectable()
export class BrasilApiProvider extends BaseHttpCepProvider {
  readonly name = 'BrasilAPI';

  constructor(
    httpService: HttpService,
    configService: ConfigService<Env, true>,
    logger: PinoLogger,
  ) {
    super(httpService, configService, logger, BrasilApiProvider.name);
  }

  async find(cep: string, signal?: AbortSignal): Promise<CepProviderResult> {
    const baseUrl = this.configService.get('BRASILAPI_BASE_URL', {
      infer: true,
    });
    const url = `${baseUrl}/${cep}`;

    const rawData = await this.fetchWithTelemetry<unknown>(url, {
      notFoundOn404: true,
      signal,
    });

    if (rawData === null) {
      return { status: 'not_found' };
    }

    const data = this.validateResponse(brasilApiResponseSchema, rawData);

    return {
      status: 'found',
      data: {
        cep: data.cep.replace('-', ''),
        street: data.street ?? '',
        complement: '',
        neighborhood: data.neighborhood ?? '',
        city: data.city,
        state: data.state,
        ibge: '',
      },
    };
  }
}
