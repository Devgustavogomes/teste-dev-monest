import { z } from "zod";

/**
 * Zod schema for environment variable validation.
 * This is the single source of truth for all configuration values.
 * The application will fail to start if any required variables are missing or invalid.
 */
export const envSchema = z.object({
  /** HTTP port the server listens on. Default: 3000 */
  PORT: z
    .string()
    .default("3000")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),

  /** Timeout in milliseconds for each CEP provider HTTP call. Default: 5000 */
  CEP_PROVIDER_TIMEOUT_MS: z
    .string()
    .default("5000")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),

  VIACEP_BASE_URL: z.string().url().default("https://viacep.com.br/ws"),

  BRASILAPI_BASE_URL: z
    .string()
    .url()
    .default("https://brasilapi.com.br/api/cep/v1"),
});

export type Env = z.infer<typeof envSchema>;

export function validate(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Environment variable validation failed:\n${formatted}\n\nCheck your .env file or environment configuration.`,
    );
  }

  return result.data;
}
