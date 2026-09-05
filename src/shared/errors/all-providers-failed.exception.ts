import { AppError } from './app.error';

export class AllProvidersFailedException extends AppError {
  constructor() {
    super(
      502,
      'All CEP providers failed. Please try again later.',
      'Bad Gateway',
    );
  }
}
