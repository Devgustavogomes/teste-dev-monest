import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { GlobalExceptionFilter } from '../../../src/shared/filters/global-exception.filter';
import { AppError } from '../../../src/shared/errors/app.error';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let host: ArgumentsHost;
  let status: ReturnType<typeof vi.fn>;
  let json: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    json = vi.fn();
    status = vi.fn().mockReturnValue({ json });
    host = {
      switchToHttp: () => ({
        getResponse: () => ({ status, json }),
        getRequest: () => ({ url: '/cep/01001000', method: 'GET' }),
      }),
    } as unknown as ArgumentsHost;
    filter = new GlobalExceptionFilter({
      setContext: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as PinoLogger);
  });

  const expectResponse = (
    expectedStatus: number,
    message: string,
    error: string,
  ) => {
    expect(status).toHaveBeenCalledWith(expectedStatus);
    expect(json).toHaveBeenCalledWith({
      statusCode: expectedStatus,
      message,
      error,
      timestamp: expect.any(String),
    });
  };

  it('preserves application error details', () => {
    filter.catch(
      new AppError(422, 'Invalid domain state', 'Unprocessable Entity'),
      host,
    );

    expectResponse(422, 'Invalid domain state', 'Unprocessable Entity');
  });

  it.each([
    [
      new HttpException('Forbidden resource', HttpStatus.FORBIDDEN),
      403,
      'Forbidden resource',
      'FORBIDDEN',
    ],
    [
      new HttpException({ message: 'Missing' }, HttpStatus.NOT_FOUND),
      404,
      'Missing',
      'NOT_FOUND',
    ],
    [
      new HttpException(
        { message: ['name is required', 'email is invalid'] },
        HttpStatus.BAD_REQUEST,
      ),
      400,
      'name is required, email is invalid',
      'BAD_REQUEST',
    ],
    [
      new HttpException({}, HttpStatus.METHOD_NOT_ALLOWED),
      405,
      'METHOD_NOT_ALLOWED',
      'METHOD_NOT_ALLOWED',
    ],
    [
      new HttpException(123 as never, HttpStatus.UNAUTHORIZED),
      401,
      'UNAUTHORIZED',
      'UNAUTHORIZED',
    ],
  ])(
    'normalizes HttpException responses',
    (exception, expectedStatus, message, error) => {
      filter.catch(exception, host);
      expectResponse(expectedStatus, message, error);
    },
  );

  it.each([new Error('failure'), 'failure', null])(
    'hides unexpected error details for %j',
    (exception) => {
      filter.catch(exception, host);
      expectResponse(500, 'Internal Server Error', 'Internal Server Error');
    },
  );
});
