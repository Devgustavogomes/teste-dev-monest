import { z } from 'zod';

export const CepResponseSchema = z.object({
  cep: z.string().describe('8-digit ZIP code without hyphen — e.g. 01001000'),
  street: z.string().describe('Street name (logradouro)'),
  complement: z.string().describe('Address complement (complemento)'),
  neighborhood: z.string().describe('Neighborhood (bairro)'),
  city: z.string().describe('City name (localidade)'),
  state: z
    .string()
    .length(2)
    .describe('State abbreviation — 2 uppercase letters (UF)'),
  ibge: z.string().describe('IBGE city code'),
});

export type CepResponse = z.infer<typeof CepResponseSchema>;
