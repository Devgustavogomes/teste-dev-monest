import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/shared/filters/global-exception.filter';

describe('CepController (e2e — real external APIs)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  }, 15000);

  afterAll(async () => {
    await app.close();
  });

  it('GET /cep/01001000 — fetches real address from provider and returns 200 with unified CepResponse', async () => {
    const response = await request(app.getHttpServer())
      .get('/cep/01001000')
      .expect(200)
      .expect('Content-Type', /json/);

    expect(response.body).toMatchObject({
      cep: '01001000',
      city: 'São Paulo',
      state: 'SP',
    });
    expect(response.body.street).toBeDefined();
    expect(response.body.neighborhood).toBeDefined();
  }, 10000);

  it('GET /cep/01001-000 — hyphenated CEP normalizes and returns 200', async () => {
    const response = await request(app.getHttpServer())
      .get('/cep/01001-000')
      .expect(200)
      .expect('Content-Type', /json/);

    expect(response.body).toMatchObject({
      cep: '01001000',
      city: 'São Paulo',
      state: 'SP',
    });
  }, 10000);

  it('GET /cep/123 — invalid format returns 400 Bad Request without hitting external APIs', async () => {
    const response = await request(app.getHttpServer())
      .get('/cep/123')
      .expect(400)
      .expect('Content-Type', /json/);

    expect(response.body).toMatchObject({
      statusCode: 400,
      message: 'Invalid CEP format. Must contain 8 numeric digits.',
      error: 'Bad Request',
    });
    expect(response.body.timestamp).toBeDefined();
  });

  it('GET /cep/abcdefgh — non-numeric CEP returns 400 Bad Request', async () => {
    const response = await request(app.getHttpServer())
      .get('/cep/abcdefgh')
      .expect(400)
      .expect('Content-Type', /json/);

    expect(response.body).toMatchObject({
      statusCode: 400,
      message: 'Invalid CEP format. Must contain 8 numeric digits.',
      error: 'Bad Request',
    });
  });

  it('GET /cep/00000000 — non-existent CEP returns 404 Not Found from real providers', async () => {
    const response = await request(app.getHttpServer())
      .get('/cep/00000000')
      .expect(404)
      .expect('Content-Type', /json/);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: 'CEP 00000000 not found.',
      error: 'Not Found',
    });
    expect(response.body.timestamp).toBeDefined();
  }, 15000);

  it('Round robin — multiple consecutive requests succeed across providers', async () => {
    const res1 = await request(app.getHttpServer())
      .get('/cep/01001000')
      .expect(200);

    const res2 = await request(app.getHttpServer())
      .get('/cep/01001000')
      .expect(200);

    expect(res1.body.city).toBe('São Paulo');
    expect(res2.body.city).toBe('São Paulo');
  }, 15000);
});
