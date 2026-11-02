import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { context, trace } from './otel-api-shim';
import type { Tracer } from './otel-api-shim';

/**
 * Lightweight tracing skeleton.
 * - Default: noop (no export, no network).
 * - OTEL_ENABLED=true + OTEL_TRACES_EXPORTER=console → structured span logs.
 * - OTEL_EXPORTER_OTLP_ENDPOINT → documented hook; full SDK install is optional
 *   (see docs/qingzhan/observability.md). This process never dials OTLP unless
 *   you wire a real exporter per that doc.
 */
@Injectable()
export class TracingService implements OnModuleInit {
  private readonly logger = new Logger(TracingService.name);
  private tracer: Tracer = trace.getTracer('qingzhan-server');

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const enabled = Boolean(this.config.get('OTEL_ENABLED'));
    const exporter = this.config.get<string>('OTEL_TRACES_EXPORTER') ?? 'none';
    if (!enabled) {
      this.logger.log('OpenTelemetry tracing disabled (OTEL_ENABLED≠true)');
      return;
    }
    if (exporter === 'console') {
      this.logger.log('OpenTelemetry console exporter active (spans → structured logs)');
      return;
    }
    if (exporter === 'otlp') {
      const ep = this.config.get<string>('OTEL_EXPORTER_OTLP_ENDPOINT');
      this.logger.warn(
        `OTEL_TRACES_EXPORTER=otlp but in-process OTLP SDK is not bundled; endpoint=${ep ?? '(unset)'}. See docs/qingzhan/observability.md to attach @opentelemetry/sdk-node.`,
      );
      return;
    }
    this.logger.log(`OpenTelemetry enabled with exporter=${exporter} (noop)`);
  }

  startSpan(name: string, attrs?: Record<string, string | number | boolean>) {
    const enabled = Boolean(this.config.get('OTEL_ENABLED'));
    const exporter = this.config.get<string>('OTEL_TRACES_EXPORTER') ?? 'none';
    const span = this.tracer.startSpan(name);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
    }
    if (enabled && exporter === 'console') {
      this.logger.log(
        JSON.stringify({
          msg: 'otel.span.start',
          name,
          attrs: attrs ?? {},
        }),
      );
    }
    return {
      end: (extra?: Record<string, string | number | boolean>) => {
        if (extra) {
          for (const [k, v] of Object.entries(extra)) span.setAttribute(k, v);
        }
        span.end();
        if (enabled && exporter === 'console') {
          this.logger.log(
            JSON.stringify({
              msg: 'otel.span.end',
              name,
              attrs: { ...attrs, ...extra },
            }),
          );
        }
      },
      // expose for future context propagation
      context,
    };
  }
}
