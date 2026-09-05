import { z } from 'zod';

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
