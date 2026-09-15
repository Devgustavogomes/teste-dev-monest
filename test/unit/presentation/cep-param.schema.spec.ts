import { describe, expect, it } from 'vitest';
import { cepSchema } from '../../../src/modules/cep/presentation/schemas/cep-param.schema';
import { ZodValidationPipe } from '../../../src/shared/pipes/zod-validation.pipe';
import { InvalidCepException } from '../../../src/shared/errors/invalid-cep.exception';

describe('CEP validation', () => {
  const pipe = new ZodValidationPipe(cepSchema);

  it.each([
    ['01001000', '01001000'],
    ['01001-000', '01001000'],
    ['00000-000', '00000000'],
    ['99999-999', '99999999'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(pipe.transform(input)).toBe(expected);
  });

  it.each([
    '',
    '123',
    '123456789',
    'abcdefgh',
    '01001-00a',
    '01001 000',
    '12.345-678',
    '        ',
  ])('rejects invalid CEP %j', (input) => {
    expect(() => pipe.transform(input)).toThrow(InvalidCepException);
  });
});
