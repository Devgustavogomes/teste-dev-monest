import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { CepResponse } from '../../presentation/schemas/cep-response.schema';
import { Env } from '../../../../shared/config/env.validation';
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

  async find(cep: string): Promise<CepResponse | null> {
    const baseUrl = this.configService.get('BRASILAPI_BASE_URL', {
      infer: true,
    });
    const url = `${baseUrl}/${cep}`;

    const rawData = await this.fetchWithTelemetry<unknown>(url, {
      notFoundOn404: true,
    });

    if (rawData === null) {
      return null;
    }

    const data = brasilApiResponseSchema.parse(rawData);

    return {
      cep: data.cep.replace('-', ''),
      street: data.street ?? '',
      complement: '',
      neighborhood: data.neighborhood ?? '',
      city: data.city,
      state: data.state,
      ibge: '',
    };
  }
}
