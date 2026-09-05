import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validate } from './shared/config/env.validation';
import { CepModule } from './modules/cep/cep.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate,
    }),
    CepModule,
    HealthModule,
  ],
})
export class AppModule {}
