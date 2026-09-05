import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { Env, validate } from './shared/config/env.validation';
import { CepModule } from './modules/cep/cep.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate,
    }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Env, true>) => {
        const isProduction =
          configService.get('NODE_ENV', { infer: true }) === 'production';

        return {
          pinoHttp: {
            level: configService.get('LOG_LEVEL', { infer: true }),
            transport: isProduction
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: {
                    singleLine: false,
                  },
                },
            genReqId: () => randomUUID(),
            autoLogging: {
              ignore: (req) => req.url === '/health',
            },
          },
        };
      },
    }),
    CepModule,
    HealthModule,
  ],
})
export class AppModule {}
