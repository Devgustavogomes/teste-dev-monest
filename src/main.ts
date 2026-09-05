import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { patchNestJsSwagger } from 'nestjs-zod';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './shared/filters/global-exception.filter';

patchNestJsSwagger();

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.useGlobalFilters(new GlobalExceptionFilter());

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

  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger UI available at: http://localhost:${port}/api/docs`);
}

void bootstrap();
