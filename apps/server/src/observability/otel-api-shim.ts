/** Minimal no-dependency stand-in for @opentelemetry/api (swap later per observability.md). */

export type Span = {
  setAttribute(key: string, value: string | number | boolean): void;
  end(): void;
};

export type Tracer = {
  startSpan(name: string): Span;
};

const noopSpan: Span = {
  setAttribute() {},
  end() {},
};

export const trace = {
  getTracer(name: string): Tracer {
    void name;
    return {
      startSpan() {
        return noopSpan;
      },
    };
  },
};

export const context = {
  active() {
    return undefined;
  },
};
