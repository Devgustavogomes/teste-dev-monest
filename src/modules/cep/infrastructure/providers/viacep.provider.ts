import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { z } from 'zod';
import { CepProvider } from '../../domain/interfaces/cep-provider.interface';
import { CepResponse } from '../../presentation/schemas/cep-response.schema';
import { Env } from '../../../../shared/config/env.validation';

const viaCepApiResponseSchema = z.union([
  z.object({
    erro: z.union([z.literal(true), z.literal('true')]),
  }),
  z.object({
    cep: z.string(),
    logradouro: z.string().default(''),
    complemento: z.string().default(''),
    bairro: z.string().default(''),
    localidade: z.string(),
    uf: z.string(),
    ibge: z.string().default(''),
  }),
]);

@Injectable()
export class ViaCepProvider implements CepProvider {
  readonly name = 'ViaCEP';

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService<Env, true>,
  ) {}

  async find(cep: string): Promise<CepResponse | null> {
    const baseUrl = this.configService.get('VIACEP_BASE_URL', { infer: true });
    const timeoutMs = this.configService.get('CEP_PROVIDER_TIMEOUT_MS', { infer: true });

    const response = await firstValueFrom(
      this.httpService.get(`${baseUrl}/${cep}/json/`, {
        timeout: timeoutMs,
      }),
    );

    const data = viaCepApiResponseSchema.parse(response.data);

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
