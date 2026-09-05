/**
 * Injection token for the array of registered CepProvider instances.
 *
 * Consumers (e.g. BuscarCep use case) should inject this token to receive
 * the full list of providers without coupling to concrete implementations:
 *
 * ```ts
 * @Inject(CEP_PROVIDERS) private readonly providers: CepProvider[]
 * ```
 *
 * Defined in a separate file to avoid circular imports between cep.module.ts
 * and find-cep.use-case.ts.
 */
export const CEP_PROVIDERS = Symbol('CEP_PROVIDERS');
