import './instrumentation';

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger, PinoLogger } from 'nestjs-pino';
import { patchNestJsSwagger } from 'nestjs-zod';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './shared/filters/global-exception.filter';

patchNestJsSwagger();

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);

  const pinoLogger = await app.resolve(PinoLogger);
  app.useGlobalFilters(new GlobalExceptionFilter(pinoLogger));

  const port = process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 3000;

  const swaggerConfig = new DocumentBuilder()
    .setTitle('API CEP')
    .setDescription(
      'REST API for Brazilian ZIP code (CEP) lookup with round-robin and automatic fallback across multiple providers.',
    )
    .setVersion('1.0')
    .addTag('cep', 'CEP lookup endpoints')
    .addTag('health', 'Application health check')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(port);

  logger.log(`Application is running on: http://localhost:${port}`);
  logger.log(`Swagger UI available at: http://localhost:${port}/api/docs`);
}

void bootstrap();
