import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { GlobalExceptionFilter } from '../../../src/shared/filters/global-exception.filter';
import { AppError } from '../../../src/shared/errors/app.error';
import { InvalidCepException } from '../../../src/shared/errors/invalid-cep.exception';
import { CepNotFoundException } from '../../../src/shared/errors/cep-not-found.exception';
import { AllProvidersFailedException } from '../../../src/shared/errors/all-providers-failed.exception';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockStatus: ReturnType<typeof vi.fn>;
  let mockJson: ReturnType<typeof vi.fn>;
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    mockJson = vi.fn();
    mockStatus = vi.fn().mockReturnValue({ json: mockJson });

    mockHost = {
      switchToHttp: vi.fn().mockReturnValue({
        getResponse: vi.fn().mockReturnValue({
          status: mockStatus,
          json: mockJson,
        }),
        getRequest: vi.fn(),
      }),
    } as unknown as ArgumentsHost;
  });

  describe('AppError instances', () => {
    it('should format InvalidCepException (400) correctly', () => {
      const exception = new InvalidCepException();

      filter.catch(exception, mockHost);

      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: 'Invalid CEP format. Must contain 8 numeric digits.',
          error: 'Bad Request',
          timestamp: expect.any(String),
        }),
      );
    });

    it('should format CepNotFoundException (404) correctly', () => {
      const exception = new CepNotFoundException('01001000');

      filter.catch(exception, mockHost);

      expect(mockStatus).toHaveBeenCalledWith(404);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          message: 'CEP 01001000 not found.',
          error: 'Not Found',
          timestamp: expect.any(String),
        }),
      );
    });

    it('should format AllProvidersFailedException (502) correctly', () => {
      const exception = new AllProvidersFailedException();

      filter.catch(exception, mockHost);

      expect(mockStatus).toHaveBeenCalledWith(502);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 502,
          message: 'All CEP providers failed. Please try again later.',
          error: 'Bad Gateway',
          timestamp: expect.any(String),
        }),
      );
    });

    it('should format custom AppError instance correctly', () => {
      const exception = new AppError(422, 'Custom unprocessable entity', 'Unprocessable Entity');

      filter.catch(exception, mockHost);

      expect(mockStatus).toHaveBeenCalledWith(422);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 422,
          message: 'Custom unprocessable entity',
          error: 'Unprocessable Entity',
          timestamp: expect.any(String),
        }),
      );
    });
  });

  describe('Standard NestJS HttpException', () => {
    it('should format HttpException with string response', () => {
      const exception = new HttpException('Forbidden resource', HttpStatus.FORBIDDEN);

      filter.catch(exception, mockHost);

      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          message: 'Forbidden resource',
          error: 'FORBIDDEN',
          timestamp: expect.any(String),
        }),
      );
    });

    it('should format HttpException with object response containing string message', () => {
      const exception = new HttpException(
        { message: 'Resource not found', custom: 'data' },
        HttpStatus.NOT_FOUND,
      );

      filter.catch(exception, mockHost);

      expect(mockStatus).toHaveBeenCalledWith(404);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          message: 'Resource not found',
          error: 'NOT_FOUND',
          timestamp: expect.any(String),
        }),
      );
    });

    it('should format HttpException with object response containing array message (e.g. validation errors)', () => {
      const exception = new HttpException(
        { message: ['name is required', 'email must be valid'] },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, mockHost);

      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: 'name is required, email must be valid',
          error: 'BAD_REQUEST',
          timestamp: expect.any(String),
        }),
      );
    });

    it('should fallback to HTTP status name when object response lacks message', () => {
      const exception = new HttpException({}, HttpStatus.METHOD_NOT_ALLOWED);

      filter.catch(exception, mockHost);

      expect(mockStatus).toHaveBeenCalledWith(405);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 405,
          message: 'METHOD_NOT_ALLOWED',
          error: 'METHOD_NOT_ALLOWED',
          timestamp: expect.any(String),
        }),
      );
    });

    it('should fallback to HTTP status name when response is neither string nor object', () => {
      const exception = new HttpException(12345 as any, HttpStatus.UNAUTHORIZED);

      filter.catch(exception, mockHost);

      expect(mockStatus).toHaveBeenCalledWith(401);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'UNAUTHORIZED',
          error: 'UNAUTHORIZED',
          timestamp: expect.any(String),
        }),
      );
    });
  });

  describe('Unknown and unexpected errors', () => {
    it('should handle standard Javascript Error with 500 Internal Server Error', () => {
      const exception = new Error('Unexpected database failure');

      filter.catch(exception, mockHost);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          message: 'Internal Server Error',
          error: 'Internal Server Error',
          timestamp: expect.any(String),
        }),
      );
    });

    it('should handle non-error primitives thrown (e.g., string)', () => {
      filter.catch('something broke', mockHost);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          message: 'Internal Server Error',
          error: 'Internal Server Error',
          timestamp: expect.any(String),
        }),
      );
    });

    it('should handle null or undefined thrown', () => {
      filter.catch(null, mockHost);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          message: 'Internal Server Error',
          error: 'Internal Server Error',
          timestamp: expect.any(String),
        }),
      );
    });
  });

  describe('Timestamp formatting', () => {
    it('should produce a valid ISO 8601 timestamp', () => {
      filter.catch(new InvalidCepException(), mockHost);

      const jsonCall = mockJson.mock.calls[0][0];
      expect(jsonCall.timestamp).toBeDefined();
      const parsedDate = new Date(jsonCall.timestamp);
      expect(parsedDate.toISOString()).toBe(jsonCall.timestamp);
    });
  });
});
