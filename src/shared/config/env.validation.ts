import { z } from 'zod';

export const envSchema = z.object({
  PORT: z
    .string()
    .default('3000')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),

  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),

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

  CB_ERROR_THRESHOLD_PERCENTAGE: z
    .string()
    .default('50')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(0).max(100)),

  CB_RESET_TIMEOUT_MS: z
    .string()
    .default('30000')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),

  CB_VOLUME_THRESHOLD: z
    .string()
    .default('5')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),

  OTEL_SERVICE_NAME: z.string().default('api-cep'),

  THROTTLE_TTL_MS: z
    .string()
    .default('60000')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),

  THROTTLE_LIMIT: z
    .string()
    .default('60')
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
