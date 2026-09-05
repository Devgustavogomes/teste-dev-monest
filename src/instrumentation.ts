import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  defaultResource,
  resourceFromAttributes,
} from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

export function initializeInstrumentation(
  env: NodeJS.ProcessEnv = process.env,
): {
  sdk: NodeSDK;
  shutdown: (signal: string) => Promise<void>;
} {
  const serviceName = env['OTEL_SERVICE_NAME'] || 'api-cep';
  const otlpEndpoint = env['OTEL_EXPORTER_OTLP_ENDPOINT'];

  const resource = defaultResource().merge(
    resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
    }),
  );

  let traceExporter: OTLPTraceExporter | undefined;
  let metricReader: PeriodicExportingMetricReader | undefined;

  if (otlpEndpoint) {
    const traceUrl = otlpEndpoint.endsWith('/v1/traces')
      ? otlpEndpoint
      : `${otlpEndpoint.replace(/\/+$/, '')}/v1/traces`;
    const metricUrl = otlpEndpoint.endsWith('/v1/metrics')
      ? otlpEndpoint
      : `${otlpEndpoint.replace(/\/+$/, '')}/v1/metrics`;

    traceExporter = new OTLPTraceExporter({ url: traceUrl });
    metricReader = new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: metricUrl }),
    });
  }

  const sdk = new NodeSDK({
    resource,
    serviceName,
    ...(traceExporter ? { traceExporter } : {}),
    ...(metricReader ? { metricReader } : {}),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });

  sdk.start();

  const shutdown = async (signal: string): Promise<void> => {
    try {
      await sdk.shutdown();
    } catch (error) {
      console.error(
        `Error during OpenTelemetry SDK shutdown on ${signal}:`,
        error,
      );
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  return { sdk, shutdown };
}

export const { sdk, shutdown } = initializeInstrumentation();
