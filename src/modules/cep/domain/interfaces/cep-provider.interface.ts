import { CepResponse } from '../../presentation/schemas/cep-response.schema';

export interface CepProvider {
  readonly name: string;
  find(cep: string): Promise<CepResponse | null>;
}
