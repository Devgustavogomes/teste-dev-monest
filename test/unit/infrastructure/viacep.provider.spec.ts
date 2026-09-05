import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { of, throwError } from 'rxjs';
import { AxiosError, AxiosResponse } from 'axios';
import { ViaCepProvider } from '../../../src/modules/cep/infrastructure/providers/viacep.provider';
import { Env } from '../../../src/shared/config/env.validation';
import { ProviderContractException } from '../../../src/shared/errors/provider-contract.exception';

describe('ViaCepProvider', () => {
  let provider: ViaCepProvider;
  let httpService: HttpService;
  let configService: ConfigService<Env, true>;

  beforeEach(() => {
    httpService = {
      get: vi.fn(),
    } as unknown as HttpService;

    configService = {
      get: vi.fn((key: string) => {
        if (key === 'VIACEP_BASE_URL') return 'https://viacep.com.br/ws';
        if (key === 'CEP_PROVIDER_TIMEOUT_MS') return 5000;
        return undefined;
      }),
    } as unknown as ConfigService<Env, true>;

    const dummyLogger = {
      setContext: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as PinoLogger;

    provider = new ViaCepProvider(httpService, configService, dummyLogger);
  });

  it('should have provider name "ViaCEP"', () => {
    expect(provider.name).toBe('ViaCEP');
  });

  describe('find()', () => {
    it('should map successful ViaCEP response to unified CepResponse contract', async () => {
      const mockApiResponse = {
        data: {
          cep: '01001-000',
          logradouro: 'Praça da Sé',
          complemento: 'lado ímpar',
          bairro: 'Sé',
          localidade: 'São Paulo',
          uf: 'SP',
          ibge: '3550308',
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      } as AxiosResponse;

      vi.spyOn(httpService, 'get').mockReturnValue(of(mockApiResponse));

      const result = await provider.find('01001000');

      expect(httpService.get).toHaveBeenCalledWith(
        'https://viacep.com.br/ws/01001000/json/',
        { timeout: 5000 },
      );
      expect(result).toEqual({
        cep: '01001000',
        street: 'Praça da Sé',
        complement: 'lado ímpar',
        neighborhood: 'Sé',
        city: 'São Paulo',
        state: 'SP',
        ibge: '3550308',
      });
    });

    it('should return null when ViaCEP returns { erro: true } (CEP not found)', async () => {
      const mockApiResponse = {
        data: {
          erro: true,
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      } as AxiosResponse;

      vi.spyOn(httpService, 'get').mockReturnValue(of(mockApiResponse));

      const result = await provider.find('99999999');

      expect(httpService.get).toHaveBeenCalledWith(
        'https://viacep.com.br/ws/99999999/json/',
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
        'getaddrinfo ENOTFOUND viacep.com.br',
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

    it('should propagate 4xx HTTP errors from HttpService', async () => {
      const clientError = new AxiosError(
        'Request failed with status code 400',
        'ERR_BAD_REQUEST',
        undefined,
        undefined,
        { status: 400, data: 'Bad Request' } as any,
      );

      vi.spyOn(httpService, 'get').mockReturnValue(
        throwError(() => clientError),
      );

      await expect(provider.find('01001000')).rejects.toThrow(clientError);
    });

    it('should throw ProviderContractException with [VIACEP] prefix when response payload is invalid', async () => {
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

      await expect(provider.find('01001000')).rejects.toThrow(
        ProviderContractException,
      );
      await expect(provider.find('01001000')).rejects.toThrow('[VIACEP]');
    });
  });
});
