import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { context, trace } from '@opentelemetry/api';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { Env, validate } from './shared/config/env.validation';
import { ObservabilityModule } from './shared/observability/observability.module';
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
        const isProduction = process.env.NODE_ENV === 'production';

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
            mixin: () => {
              try {
                const span = trace.getSpan(context.active());
                if (!span) {
                  return {};
                }
                const spanContext = span.spanContext();
                if (!spanContext || !trace.isSpanContextValid(spanContext)) {
                  return {};
                }
                return {
                  trace_id: spanContext.traceId,
                  span_id: spanContext.spanId,
                };
              } catch {
                return {};
              }
            },
          },
        };
      },
    }),
    ObservabilityModule,
    CepModule,
    HealthModule,
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Env, true>) => [
        {
          ttl: configService.get('THROTTLE_TTL_MS', { infer: true }),
          limit: configService.get('THROTTLE_LIMIT', { infer: true }),
        },
      ],
    }),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
