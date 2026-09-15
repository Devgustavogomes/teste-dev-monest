import '../../src/instrumentation';

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Logger, PinoLogger } from 'nestjs-pino';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/shared/filters/global-exception.filter';

describe('CepController (e2e — real external APIs)', () => {
  let app: INestApplication;
  let client: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useLogger(app.get(Logger));
    const pinoLogger = await app.resolve(PinoLogger);
    app.useGlobalFilters(new GlobalExceptionFilter(pinoLogger));
    await app.init();
    await app.listen(0);
    client = request.agent(app.getHttpServer());
  }, 15000);

  afterAll(async () => {
    await app.close();
  });

  it('GET /cep/01001000 — Cache Miss on first request (X-Cache: MISS) and Cache Hit on immediate subsequent request (X-Cache: HIT) under 5ms', async () => {
    const firstResponse = await request(app.getHttpServer())
      .get('/cep/01001000')
      .expect(200)
      .expect('Content-Type', /json/);

    const firstXCache =
      firstResponse.headers['x-cache'] ?? firstResponse.get('x-cache');
    expect(firstXCache?.toUpperCase()).toBe('MISS');
    expect(firstResponse.body).toMatchObject({
      cep: '01001000',
      city: 'São Paulo',
      state: 'SP',
    });
    expect(firstResponse.body.street).toBeDefined();
    expect(firstResponse.body.neighborhood).toBeDefined();

    const secondResponse = await client
      .get('/cep/01001000')
      .expect(200)
      .expect('Content-Type', /json/);

    const secondXCache =
      secondResponse.headers['x-cache'] ?? secondResponse.get('x-cache');
    expect(secondXCache?.toUpperCase()).toBe('HIT');
    expect(secondResponse.body).toEqual(firstResponse.body);
  }, 15000);

  it('GET /cep/01001-000 — hyphenated and unhyphenated queries share the same cache entry (X-Cache: HIT)', async () => {
    const response = await request(app.getHttpServer())
      .get('/cep/01001-000')
      .expect(200)
      .expect('Content-Type', /json/);

    const xCache = response.headers['x-cache'] ?? response.get('x-cache');
    expect(xCache?.toUpperCase()).toBe('HIT');
    expect(response.body).toMatchObject({
      cep: '01001000',
      city: 'São Paulo',
      state: 'SP',
    });
  }, 10000);

  it('GET /cep/00000000 — Negative Caching: returns 404 with X-Cache: MISS on first query and X-Cache: HIT on subsequent query', async () => {
    const firstResponse = await request(app.getHttpServer())
      .get('/cep/00000000')
      .expect(404)
      .expect('Content-Type', /json/);

    const firstXCache =
      firstResponse.headers['x-cache'] ?? firstResponse.get('x-cache');
    expect(firstXCache?.toUpperCase()).toBe('MISS');
    expect(firstResponse.body).toMatchObject({
      statusCode: 404,
      message: 'CEP 00000000 not found.',
      error: 'Not Found',
    });
    expect(firstResponse.body.timestamp).toBeDefined();

    const secondResponse = await client
      .get('/cep/00000000')
      .expect(404)
      .expect('Content-Type', /json/);

    const secondXCache =
      secondResponse.headers['x-cache'] ?? secondResponse.get('x-cache');
    expect(secondXCache?.toUpperCase()).toBe('HIT');
    expect(secondResponse.body).toMatchObject({
      statusCode: 404,
      message: 'CEP 00000000 not found.',
      error: 'Not Found',
    });
    expect(secondResponse.body.timestamp).toBeDefined();
  }, 15000);

  it.each(['123', 'abcdefgh'])(
    'GET /cep/%s — invalid CEP returns 400 without caching',
    async (invalidCep) => {
      const response = await request(app.getHttpServer())
        .get(`/cep/${invalidCep}`)
        .expect(400)
        .expect('Content-Type', /json/);

      expect(response.body).toMatchObject({
        statusCode: 400,
        message: 'Invalid CEP format. Must contain 8 numeric digits.',
        error: 'Bad Request',
      });
      const xCache = response.headers['x-cache'] ?? response.get('x-cache');
      expect(xCache).toBeUndefined();
    },
  );
});
