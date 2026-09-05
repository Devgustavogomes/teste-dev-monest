import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ViaCepProvider } from './infrastructure/providers/viacep.provider';
import { BrasilApiProvider } from './infrastructure/providers/brasilapi.provider';
import { Env } from '../../shared/config/env.validation';
import { BuscarCepUseCase } from './application/use-cases/buscar-cep.use-case';
import { CepController } from './presentation/controllers/cep.controller';
import { CEP_PROVIDERS } from './cep.constants';
import { RoundRobinStrategy } from '../../shared/strategies/round-robin.strategy';
import { CepProvider } from './domain/interfaces/cep-provider.interface';
import { CACHE_PROVIDER } from '../../shared/cache/cache.constants';
import { LruCacheProvider } from '../../shared/cache/lru-cache.provider';
import { CepCacheInterceptor } from './presentation/interceptors/cep-cache.interceptor';
import { CircuitBreakerCepProvider } from '../../shared/circuit-breaker/circuit-breaker-cep-provider';


@Module({
  imports: [
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Env, true>) => ({
        timeout: configService.get('CEP_PROVIDER_TIMEOUT_MS', { infer: true }),
      }),
    }),
  ],
  controllers: [CepController],
  providers: [
    ViaCepProvider,
    BrasilApiProvider,
    {
      provide: CEP_PROVIDERS,
      useFactory: (
        viaCep: ViaCepProvider,
        brasilApi: BrasilApiProvider,
        configService: ConfigService<Env, true>,
      ) => {
        const options = {
          errorThresholdPercentage: configService.get('CB_ERROR_THRESHOLD_PERCENTAGE', { infer: true }),
          resetTimeout: configService.get('CB_RESET_TIMEOUT_MS', { infer: true }),
          timeout: configService.get('CEP_PROVIDER_TIMEOUT_MS', { infer: true }),
          volumeThreshold: configService.get('CB_VOLUME_THRESHOLD', { infer: true }),
        };
        const providers: CepProvider[] = [viaCep, brasilApi];
        return providers.map(p => new CircuitBreakerCepProvider(p, options));
      },
      inject: [ViaCepProvider, BrasilApiProvider, ConfigService],
    },
    {
      provide: RoundRobinStrategy,
      useFactory: (providers: CepProvider[]) =>
        new RoundRobinStrategy(providers),
      inject: [CEP_PROVIDERS],
    },
    BuscarCepUseCase,
    {
      provide: CACHE_PROVIDER,
      useClass: LruCacheProvider,
    },
    CepCacheInterceptor,
  ],
})
export class CepModule {}
