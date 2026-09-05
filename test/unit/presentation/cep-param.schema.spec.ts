import { describe, it, expect } from 'vitest';
import { cepSchema } from '../../../src/modules/cep/presentation/schemas/cep-param.schema';
import { ZodValidationPipe } from '../../../src/shared/pipes/zod-validation.pipe';
import { InvalidCepException } from '../../../src/shared/errors/invalid-cep.exception';

describe('cepSchema and ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(cepSchema);

  describe('Valid formats & normalization', () => {
    it('should parse an 8-digit string without hyphen', () => {
      const result = cepSchema.safeParse('01001000');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('01001000');
      }
    });

    it('should normalize and strip hyphen from standard formatted CEP (01001-000)', () => {
      const result = cepSchema.safeParse('01001-000');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('01001000');
      }
    });

    it('should normalize CEP with leading zeros correctly', () => {
      const result = cepSchema.safeParse('00000-000');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('00000000');
      }
    });

    it('should work with arbitrary valid 8-digit numeric values', () => {
      const result = cepSchema.safeParse('99999-999');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('99999999');
      }
    });

    it('should transform via ZodValidationPipe', () => {
      expect(pipe.transform('01001-000')).toBe('01001000');
      expect(pipe.transform('01001000')).toBe('01001000');
    });
  });

  describe('Invalid formats', () => {
    it('should fail when input is empty string', () => {
      expect(cepSchema.safeParse('').success).toBe(false);
      expect(() => pipe.transform('')).toThrow(InvalidCepException);
    });

    it('should fail when input is too short', () => {
      expect(cepSchema.safeParse('123').success).toBe(false);
      expect(cepSchema.safeParse('1234567').success).toBe(false);
      expect(cepSchema.safeParse('1234-56').success).toBe(false);
      expect(() => pipe.transform('123')).toThrow(InvalidCepException);
    });

    it('should fail when input is too long', () => {
      expect(cepSchema.safeParse('123456789').success).toBe(false);
      expect(cepSchema.safeParse('01001-0000').success).toBe(false);
      expect(cepSchema.safeParse('010010000000').success).toBe(false);
      expect(() => pipe.transform('123456789')).toThrow(InvalidCepException);
    });

    it('should fail when input contains non-numeric characters', () => {
      expect(cepSchema.safeParse('abcdefgh').success).toBe(false);
      expect(cepSchema.safeParse('01001-00a').success).toBe(false);
      expect(cepSchema.safeParse('01001-00_').success).toBe(false);
      expect(cepSchema.safeParse('01001 000').success).toBe(false);
      expect(cepSchema.safeParse('12.345-678').success).toBe(false);
      expect(() => pipe.transform('abcdefgh')).toThrow(InvalidCepException);
    });

    it('should fail when input contains only whitespace', () => {
      expect(cepSchema.safeParse('        ').success).toBe(false);
      expect(() => pipe.transform('        ')).toThrow(InvalidCepException);
    });

    it('should throw InvalidCepException with correct properties via pipe', () => {
      try {
        pipe.transform('invalid');
        expect.fail('Expected InvalidCepException to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidCepException);
        const exception = err as InvalidCepException;
        expect(exception.getStatus()).toBe(400);
        const response = exception.getResponse();
        expect(response.statusCode).toBe(400);
        expect(response.message).toBe(
          'Invalid CEP format. Must contain 8 numeric digits.',
        );
        expect(response.error).toBe('Bad Request');
      }
    });
  });
});
