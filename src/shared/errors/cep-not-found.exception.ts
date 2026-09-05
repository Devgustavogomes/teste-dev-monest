import { AppError } from './app.error';

export class CepNotFoundException extends AppError {
  constructor(cep: string) {
    super(404, `CEP ${cep} not found.`, 'Not Found');
  }
}
