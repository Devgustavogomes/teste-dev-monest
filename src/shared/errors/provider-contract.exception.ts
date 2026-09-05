import { z } from 'zod';

export class ProviderContractException extends Error {
  readonly code = 'PROVIDER_CONTRACT_VIOLATION';

  constructor(
    public readonly providerName: string,
    public readonly issues: z.ZodIssue[],
    public readonly rawData?: unknown,
  ) {
    const formattedIssues = issues
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join(' | ');

    super(
      `[${providerName}] Provider contract violation: ${formattedIssues || 'Invalid payload structure'}`,
    );
    this.name = 'ProviderContractException';
  }
}
