import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { z } from 'zod';
import { CepProvider } from '../../domain/interfaces/cep-provider.interface';
import { CepResponse } from '../../presentation/schemas/cep-response.schema';
import { Env } from '../../../../shared/config/env.validation';

export const viaCepApiResponseSchema = z.union(
  [
    z.object({
      erro: z.union([z.literal(true), z.literal('true')], {
        errorMap: () => ({
          message:
            "[VIACEP] Field 'erro' must be boolean true or string 'true'",
        }),
      }),
    }),
    z.object({
      cep: z.string({
        required_error: "[VIACEP] Field 'cep' is required",
        invalid_type_error: "[VIACEP] Field 'cep' must be a string",
      }),
      logradouro: z
        .string({
          invalid_type_error: "[VIACEP] Field 'logradouro' must be a string",
        })
        .default(''),
      complemento: z
        .string({
          invalid_type_error: "[VIACEP] Field 'complemento' must be a string",
        })
        .default(''),
      bairro: z
        .string({
          invalid_type_error: "[VIACEP] Field 'bairro' must be a string",
        })
        .default(''),
      localidade: z.string({
        required_error: "[VIACEP] Field 'localidade' is required",
        invalid_type_error: "[VIACEP] Field 'localidade' must be a string",
      }),
      uf: z.string({
        required_error: "[VIACEP] Field 'uf' is required",
        invalid_type_error: "[VIACEP] Field 'uf' must be a string",
      }),
      ibge: z
        .string({
          invalid_type_error: "[VIACEP] Field 'ibge' must be a string",
        })
        .default(''),
    }),
  ],
  {
    errorMap: () => ({
      message: '[VIACEP] Invalid response format from ViaCEP API',
    }),
  },
);

export type ViaCepApiResponse = z.infer<typeof viaCepApiResponseSchema>;

@Injectable()
export class ViaCepProvider implements CepProvider {
  readonly name = 'ViaCEP';

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService<Env, true>,
  ) {}

  async find(cep: string): Promise<CepResponse | null> {
    const baseUrl = this.configService.get('VIACEP_BASE_URL', { infer: true });
    const timeoutMs = this.configService.get('CEP_PROVIDER_TIMEOUT_MS', {
      infer: true,
    });

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
