import { CepResponse } from '../../presentation/schemas/cep-response.schema';

export type CepProviderResult =
  { status: 'found'; data: CepResponse } | { status: 'not_found' };

export interface CepProvider {
  readonly name: string;
  find(cep: string, signal?: AbortSignal): Promise<CepProviderResult>;
}
