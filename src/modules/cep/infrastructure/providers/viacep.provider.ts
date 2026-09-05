import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { CepResponse } from '../../presentation/schemas/cep-response.schema';
import { Env } from '../../../../shared/config/env.validation';
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

  async find(cep: string): Promise<CepResponse | null> {
    const baseUrl = this.configService.get('VIACEP_BASE_URL', { infer: true });
    const url = `${baseUrl}/${cep}/json/`;

    const rawData = await this.fetchWithTelemetry<unknown>(url);

    if (rawData === null) {
      return null;
    }

    const data = this.validateResponse(viaCepApiResponseSchema, rawData);

    if (!('cep' in data)) {
      return null;
    }

    return {
      cep: data.cep.replace('-', ''),
      street: data.logradouro,
      complement: data.complemento,
      neighborhood: data.bairro,
      city: data.localidade,
      state: data.uf,
      ibge: data.ibge,
    };
  }
}
