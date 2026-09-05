import { z } from 'zod';

export const brasilApiResponseSchema = z.object({
  cep: z.string({
    required_error: "[BRASILAPI] Field 'cep' is required",
    invalid_type_error: "[BRASILAPI] Field 'cep' must be a string",
  }),
  state: z.string({
    required_error: "[BRASILAPI] Field 'state' is required",
    invalid_type_error: "[BRASILAPI] Field 'state' must be a string",
  }),
  city: z.string({
    required_error: "[BRASILAPI] Field 'city' is required",
    invalid_type_error: "[BRASILAPI] Field 'city' must be a string",
  }),
  neighborhood: z
    .string({
      invalid_type_error: "[BRASILAPI] Field 'neighborhood' must be a string",
    })
    .nullable()
    .optional()
    .default(''),
  street: z
    .string({
      invalid_type_error: "[BRASILAPI] Field 'street' must be a string",
    })
    .nullable()
    .optional()
    .default(''),
  service: z
    .string({
      invalid_type_error: "[BRASILAPI] Field 'service' must be a string",
    })
    .optional(),
});

export type BrasilApiResponse = z.infer<typeof brasilApiResponseSchema>;
