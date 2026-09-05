import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ProviderContractException } from '../../../src/shared/errors/provider-contract.exception';

describe('ProviderContractException', () => {
  it('should instantiate with code, name, providerName, issues and formatted message', () => {
    const dummySchema = z.object({
      cep: z.string(),
      localidade: z.string(),
    });

    const parseResult = dummySchema.safeParse({
      cep: 12345,
    });

    expect(parseResult.success).toBe(false);
    if (parseResult.success) return;

    const rawData = { cep: 12345 };
    const exception = new ProviderContractException(
      'ViaCEP',
      parseResult.error.issues,
      rawData,
    );

    expect(exception).toBeInstanceOf(Error);
    expect(exception).toBeInstanceOf(ProviderContractException);
    expect(exception.name).toBe('ProviderContractException');
    expect(exception.code).toBe('PROVIDER_CONTRACT_VIOLATION');
    expect(exception.providerName).toBe('ViaCEP');
    expect(exception.issues).toEqual(parseResult.error.issues);
    expect(exception.rawData).toEqual(rawData);

    expect(exception.message).toContain(
      '[ViaCEP] Provider contract violation:',
    );
    expect(exception.message).toContain('cep:');
    expect(exception.message).toContain('localidade:');
  });

  it('should format message with fallback when issues are empty', () => {
    const exception = new ProviderContractException('BrasilAPI', []);
    expect(exception.message).toBe(
      '[BrasilAPI] Provider contract violation: Invalid payload structure',
    );
  });
});
