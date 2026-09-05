import { z } from 'zod';

export const cepSchema = z
  .string()
  .regex(/^\d{5}-?\d{3}$/, 'CEP must be in the format 00000000 or 00000-000')
  .describe(
    'Brazilian ZIP code (CEP) with or without hyphen — e.g. 01001000 or 01001-000',
  )
  .transform((val) => val.replace('-', ''));

export type Cep = z.infer<typeof cepSchema>;
