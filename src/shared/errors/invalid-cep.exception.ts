import { AppError } from './app.error';

export class InvalidCepException extends AppError {
  constructor() {
    super(
      400,
      'Invalid CEP format. Must contain 8 numeric digits.',
      'Bad Request',
    );
  }
}
