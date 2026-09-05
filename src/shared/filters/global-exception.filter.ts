import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { AppError } from '../errors/app.error';

interface ErrorDetails {
  statusCode: number;
  message: string;
  error: string;
}

@Injectable()
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger?: PinoLogger) {
    this.logger?.setContext(GlobalExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const errorDetails = this.resolveException(exception);

    this.logException(exception, errorDetails, request);

    response.status(errorDetails.statusCode).json({
      statusCode: errorDetails.statusCode,
      message: errorDetails.message,
      error: errorDetails.error,
      timestamp: new Date().toISOString(),
    });
  }

  private logException(
    exception: unknown,
    details: ErrorDetails,
    request: Request,
  ): void {
    if (!this.logger) return;

    const { statusCode, message, error } = details;
    const basePayload = {
      statusCode,
      error,
      message,
      path: request?.url,
      method: request?.method,
    };

    if (statusCode >= 500) {
      const err =
        exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error({ ...basePayload, err }, message);
    } else if (statusCode >= 400) {
      this.logger.warn(basePayload, message);
    }
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
