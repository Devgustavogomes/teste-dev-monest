import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { AxiosError, AxiosResponse } from 'axios';
import { BrasilApiProvider } from '../../../src/modules/cep/infrastructure/providers/brasilapi.provider';
import { Env } from '../../../src/shared/config/env.validation';

describe('BrasilApiProvider', () => {
  let provider: BrasilApiProvider;
  let httpService: HttpService;
  let configService: ConfigService<Env, true>;

  beforeEach(() => {
    httpService = {
      get: vi.fn(),
    } as unknown as HttpService;

    configService = {
      get: vi.fn((key: string) => {
        if (key === 'BRASILAPI_BASE_URL')
          return 'https://brasilapi.com.br/api/cep/v1';
        if (key === 'CEP_PROVIDER_TIMEOUT_MS') return 5000;
        return undefined;
      }),
    } as unknown as ConfigService<Env, true>;

    provider = new BrasilApiProvider(httpService, configService);
  });

  it('should have provider name "BrasilAPI"', () => {
    expect(provider.name).toBe('BrasilAPI');
  });

  describe('find()', () => {
    it('should map successful BrasilAPI response to unified CepResponse contract', async () => {
      const mockApiResponse = {
        data: {
          cep: '01001-000',
          state: 'SP',
          city: 'São Paulo',
          neighborhood: 'Sé',
          street: 'Praça da Sé',
          service: 'viacep',
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      } as AxiosResponse;

      vi.spyOn(httpService, 'get').mockReturnValue(of(mockApiResponse));

      const result = await provider.find('01001000');

      expect(httpService.get).toHaveBeenCalledWith(
        'https://brasilapi.com.br/api/cep/v1/01001000',
        { timeout: 5000 },
      );
      expect(result).toEqual({
        cep: '01001000',
        street: 'Praça da Sé',
        complement: '',
        neighborhood: 'Sé',
        city: 'São Paulo',
        state: 'SP',
        ibge: '',
      });
    });

    it('should handle missing optional fields (street/neighborhood) with fallback empty strings', async () => {
      const mockApiResponse = {
        data: {
          cep: '01001-000',
          state: 'SP',
          city: 'São Paulo',
          service: 'correios',
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      } as AxiosResponse;

      vi.spyOn(httpService, 'get').mockReturnValue(of(mockApiResponse));

      const result = await provider.find('01001000');

      expect(result).toEqual({
        cep: '01001000',
        street: '',
        complement: '',
        neighborhood: '',
        city: 'São Paulo',
        state: 'SP',
        ibge: '',
      });
    });

    it('should return null when BrasilAPI returns HTTP 404 (CEP not found)', async () => {
      const notFoundError = new AxiosError(
        'Request failed with status code 404',
        'ERR_BAD_REQUEST',
        undefined,
        undefined,
        { status: 404, data: { message: 'CEP não encontrado' } } as any,
      );

      vi.spyOn(httpService, 'get').mockReturnValue(
        throwError(() => notFoundError),
      );

      const result = await provider.find('99999999');

      expect(httpService.get).toHaveBeenCalledWith(
        'https://brasilapi.com.br/api/cep/v1/99999999',
        { timeout: 5000 },
      );
      expect(result).toBeNull();
    });

    it('should propagate timeout errors from HttpService', async () => {
      const timeoutError = new AxiosError(
        'timeout of 5000ms exceeded',
        'ECONNABORTED',
      );

      vi.spyOn(httpService, 'get').mockReturnValue(
        throwError(() => timeoutError),
      );

      await expect(provider.find('01001000')).rejects.toThrow(timeoutError);
    });

    it('should propagate network errors from HttpService', async () => {
      const networkError = new AxiosError(
        'getaddrinfo ENOTFOUND brasilapi.com.br',
        'ENOTFOUND',
      );

      vi.spyOn(httpService, 'get').mockReturnValue(
        throwError(() => networkError),
      );

      await expect(provider.find('01001000')).rejects.toThrow(networkError);
    });

    it('should propagate 5xx HTTP errors from HttpService', async () => {
      const serverError = new AxiosError(
        'Request failed with status code 500',
        'ERR_BAD_RESPONSE',
        undefined,
        undefined,
        { status: 500, data: 'Internal Server Error' } as any,
      );

      vi.spyOn(httpService, 'get').mockReturnValue(
        throwError(() => serverError),
      );

      await expect(provider.find('01001000')).rejects.toThrow(serverError);
    });

    it('should propagate generic errors not related to Axios', async () => {
      const unexpectedError = new Error('Unexpected runtime exception');

      vi.spyOn(httpService, 'get').mockReturnValue(
        throwError(() => unexpectedError),
      );

      await expect(provider.find('01001000')).rejects.toThrow(unexpectedError);
    });

    it('should throw ZodError with [BRASILAPI] prefix when response payload is invalid', async () => {
      const invalidResponse = {
        data: {
          invalid_field: 123,
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      } as AxiosResponse;

      vi.spyOn(httpService, 'get').mockReturnValue(of(invalidResponse));

      await expect(provider.find('01001000')).rejects.toThrow('[BRASILAPI]');
    });
  });
});
