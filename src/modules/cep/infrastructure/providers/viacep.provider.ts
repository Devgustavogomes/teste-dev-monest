import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { Env } from '../../../../shared/config/env.validation';
import { CepProviderResult } from '../../domain/interfaces/cep-provider.interface';
import { BaseHttpCepProvider } from './base-http-cep.provider';
import {
  viaCepApiResponseSchema,
  ViaCepApiResponse,
} from './schemas/viacep-response.schema';

export { viaCepApiResponseSchema, ViaCepApiResponse };

@Injectable()
export class ViaCepProvider extends BaseHttpCepProvider {
  readonly name = 'ViaCEP';

  constructor(
    httpService: HttpService,
    configService: ConfigService<Env, true>,
    logger: PinoLogger,
  ) {
    super(httpService, configService, logger, ViaCepProvider.name);
  }

  async find(cep: string, signal?: AbortSignal): Promise<CepProviderResult> {
    const baseUrl = this.configService.get('VIACEP_BASE_URL', { infer: true });
    const url = `${baseUrl}/${cep}/json/`;

    const rawData = await this.fetchWithTelemetry<unknown>(url, { signal });

    if (rawData === null) {
      return { status: 'not_found' };
    }

    const data = this.validateResponse(viaCepApiResponseSchema, rawData);

    if (!('cep' in data)) {
      return { status: 'not_found' };
    }

    return {
      status: 'found',
      data: {
        cep: data.cep.replace('-', ''),
        street: data.logradouro,
        complement: data.complemento,
        neighborhood: data.bairro,
        city: data.localidade,
        state: data.uf,
        ibge: data.ibge,
      },
    };
  }
}
