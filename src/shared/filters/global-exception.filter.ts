import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { AppError } from '../errors/app.error';

interface ErrorDetails {
  statusCode: number;
  message: string;
  error: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const { statusCode, message, error } = this.resolveException(exception);

    response.status(statusCode).json({
      statusCode,
      message,
      error,
      timestamp: new Date().toISOString(),
    });
  }

  private resolveException(exception: unknown): ErrorDetails {
    if (exception instanceof AppError) {
      const appResponse = exception.getResponse();
      return {
        statusCode: appResponse.statusCode,
        message: appResponse.message,
        error: appResponse.error,
      };
    }

    if (exception instanceof HttpException) {
      return this.handleHttpException(exception);
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal Server Error',
      error: 'Internal Server Error',
    };
  }

  private handleHttpException(exception: HttpException): ErrorDetails {
    const statusCode = exception.getStatus();
    const exceptionResponse = exception.getResponse();
    const fallback = HttpStatus[statusCode] ?? 'Error';

    if (typeof exceptionResponse === 'string') {
      return {
        statusCode,
        message: exceptionResponse,
        error: fallback,
      };
    }

    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const res = exceptionResponse as Record<string, unknown>;
      return {
        statusCode,
        message: this.extractMessage(res['message'], fallback),
        error: fallback,
      };
    }

    return {
      statusCode,
      message: fallback,
      error: fallback,
    };
  }

  private extractMessage(rawMessage: unknown, fallback: string): string {
    if (typeof rawMessage === 'string') {
      return rawMessage;
    }
    if (Array.isArray(rawMessage)) {
      return rawMessage.join(', ');
    }
    return fallback;
  }
}
