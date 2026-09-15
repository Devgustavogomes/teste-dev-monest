import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';
import { ViaCepProvider } from '../../../src/modules/cep/infrastructure/providers/viacep.provider';
import { Env } from '../../../src/shared/config/env.validation';
import { ProviderContractException } from '../../../src/shared/errors/provider-contract.exception';

const response = (data: unknown): AxiosResponse =>
  ({
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {},
  }) as AxiosResponse;

describe('ViaCepProvider', () => {
  let provider: ViaCepProvider;
  let httpService: HttpService;

  beforeEach(() => {
    httpService = { get: vi.fn() } as unknown as HttpService;
    const configService = {
      get: vi.fn((key: string) =>
        key === 'VIACEP_BASE_URL' ? 'https://viacep.com.br/ws' : 2000,
      ),
    } as unknown as ConfigService<Env, true>;
    const logger = {
      setContext: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as PinoLogger;

    provider = new ViaCepProvider(httpService, configService, logger);
  });

  it('maps a successful response and forwards timeout and abort signal', async () => {
    const controller = new AbortController();
    vi.mocked(httpService.get).mockReturnValue(
      of(
        response({
          cep: '01001-000',
          logradouro: 'Praca da Se',
          complemento: '',
          bairro: 'Se',
          localidade: 'Sao Paulo',
          uf: 'SP',
          ibge: '3550308',
        }),
      ),
    );

    await expect(provider.find('01001000', controller.signal)).resolves.toEqual(
      {
        status: 'found',
        data: {
          cep: '01001000',
          street: 'Praca da Se',
          complement: '',
          neighborhood: 'Se',
          city: 'Sao Paulo',
          state: 'SP',
          ibge: '3550308',
        },
      },
    );
    expect(httpService.get).toHaveBeenCalledWith(
      'https://viacep.com.br/ws/01001000/json/',
      { timeout: 2000, signal: controller.signal },
    );
  });

  it('maps the ViaCEP absence payload to not_found', async () => {
    vi.mocked(httpService.get).mockReturnValue(of(response({ erro: true })));

    await expect(provider.find('99999999')).resolves.toEqual({
      status: 'not_found',
    });
  });

  it('propagates upstream failures', async () => {
    const upstreamError = new Error('network error');
    vi.mocked(httpService.get).mockReturnValue(throwError(() => upstreamError));

    await expect(provider.find('01001000')).rejects.toBe(upstreamError);
  });

  it('rejects payloads outside the provider contract', async () => {
    vi.mocked(httpService.get).mockReturnValue(of(response({ invalid: true })));

    await expect(provider.find('01001000')).rejects.toBeInstanceOf(
      ProviderContractException,
    );
  });
});
