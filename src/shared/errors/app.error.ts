import { HttpException } from '@nestjs/common';

export class AppError extends HttpException {
  constructor(statusCode: number, message: string, error: string) {
    const timestamp = new Date().toISOString();
    super({ statusCode, message, error, timestamp }, statusCode);
  }

  override getResponse(): {
    statusCode: number;
    message: string;
    error: string;
    timestamp: string;
  } {
    return super.getResponse() as {
      statusCode: number;
      message: string;
      error: string;
      timestamp: string;
    };
  }
}
