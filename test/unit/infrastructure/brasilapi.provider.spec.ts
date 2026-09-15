import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';
import { BrasilApiProvider } from '../../../src/modules/cep/infrastructure/providers/brasilapi.provider';
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

const axiosError = (status: number) => ({
  isAxiosError: true,
  message: `Request failed with status code ${status}`,
  response: { status },
});

describe('BrasilApiProvider', () => {
  let provider: BrasilApiProvider;
  let httpService: HttpService;

  beforeEach(() => {
    httpService = { get: vi.fn() } as unknown as HttpService;
    const configService = {
      get: vi.fn((key: string) =>
        key === 'BRASILAPI_BASE_URL'
          ? 'https://brasilapi.com.br/api/cep/v1'
          : 2000,
      ),
    } as unknown as ConfigService<Env, true>;
    const logger = {
      setContext: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as PinoLogger;

    provider = new BrasilApiProvider(httpService, configService, logger);
  });

  it('maps a successful response to the shared contract', async () => {
    vi.mocked(httpService.get).mockReturnValue(
      of(
        response({
          cep: '01001-000',
          state: 'SP',
          city: 'Sao Paulo',
          neighborhood: 'Se',
          street: 'Praca da Se',
          service: 'viacep',
        }),
      ),
    );

    await expect(provider.find('01001000')).resolves.toEqual({
      status: 'found',
      data: {
        cep: '01001000',
        street: 'Praca da Se',
        complement: '',
        neighborhood: 'Se',
        city: 'Sao Paulo',
        state: 'SP',
        ibge: '',
      },
    });
  });

  it('defaults optional address fields to empty strings', async () => {
    vi.mocked(httpService.get).mockReturnValue(
      of(
        response({
          cep: '01001-000',
          state: 'SP',
          city: 'Sao Paulo',
          service: 'correios',
        }),
      ),
    );

    const result = await provider.find('01001000');

    expect(result).toMatchObject({
      status: 'found',
      data: { street: '', neighborhood: '' },
    });
  });

  it('maps Axios-compatible 404 errors to not_found', async () => {
    vi.mocked(httpService.get).mockReturnValue(
      throwError(() => axiosError(404)),
    );

    await expect(provider.find('99999999')).resolves.toEqual({
      status: 'not_found',
    });
  });

  it('does not classify other upstream failures as not_found', async () => {
    const upstreamError = axiosError(500);
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
