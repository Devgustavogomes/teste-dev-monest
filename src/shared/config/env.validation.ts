import { z } from 'zod';

/**
 * Zod schema for environment variable validation.
 * This is the single source of truth for all configuration values.
 * The application will fail to start if any required variables are missing or invalid.
 */
export const envSchema = z.object({
  /** HTTP port the server listens on. Default: 3000 */
  PORT: z
    .string()
    .default('3000')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),

  /** Log level for Pino logger. Default: 'info' */
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),

  /** Application environment mode. Default: 'development' */
  NODE_ENV: z.string().default('development'),

  /** Timeout in milliseconds for each CEP provider HTTP call. Default: 5000 */
  CEP_PROVIDER_TIMEOUT_MS: z
    .string()
    .default('5000')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),

  VIACEP_BASE_URL: z.string().url().default('https://viacep.com.br/ws'),

  BRASILAPI_BASE_URL: z
    .string()
    .url()
    .default('https://brasilapi.com.br/api/cep/v1'),

  CACHE_TTL_MS: z
    .string()
    .default('86400000')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),

  CACHE_NEGATIVE_TTL_MS: z
    .string()
    .default('600000')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),

  /** Percentage of failures in the rolling window to trip the circuit. Default: 50 */
  CB_ERROR_THRESHOLD_PERCENTAGE: z
    .string()
    .default('50')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(0).max(100)),

  /** Time in ms the circuit stays open before entering half-open. Default: 30000 */
  CB_RESET_TIMEOUT_MS: z
    .string()
    .default('30000')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),

  /** Minimum number of requests in the rolling window before evaluating the error threshold. Default: 5 */
  CB_VOLUME_THRESHOLD: z
    .string()
    .default('5')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
});

export type Env = z.infer<typeof envSchema>;

export function validate(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Environment variable validation failed:\n${formatted}\n\nCheck your .env file or environment configuration.`,
    );
  }

  return result.data;
}
