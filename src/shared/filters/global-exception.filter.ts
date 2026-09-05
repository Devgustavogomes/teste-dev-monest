import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { AppError } from '../errors/app.error';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let statusCode: number;
    let message: string;
    let error: string;

    if (exception instanceof AppError) {
      // Custom application error — use its standardized response directly
      const appResponse = exception.getResponse();
      statusCode = appResponse.statusCode;
      message = appResponse.message;
      error = appResponse.error;
    } else if (exception instanceof HttpException) {
      // Standard NestJS HttpException (not an AppError)
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const responseObj = exceptionResponse as Record<string, unknown>;
        message =
          typeof responseObj['message'] === 'string'
            ? responseObj['message']
            : Array.isArray(responseObj['message'])
              ? (responseObj['message'] as string[]).join(', ')
              : (HttpStatus[statusCode] ?? 'Error');
      } else {
        message = HttpStatus[statusCode] ?? 'Error';
      }

      error = HttpStatus[statusCode] ?? 'Error';
    } else {
      // Unexpected / unknown error — return generic 500
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal Server Error';
      error = 'Internal Server Error';
    }

    const timestamp = new Date().toISOString();

    response.status(statusCode).json({
      statusCode,
      message,
      error,
      timestamp,
    });
  }
}
