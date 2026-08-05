/**
 * Performance instrumentation helper for SupaChat ultra-fast startup.
 * Logs high-resolution timestamps and measures execution duration for every startup milestone.
 */

const markers = new Map<string, number>();

export const startupAudit = {
  mark(name: string) {
    const time = performance.now();
    markers.set(name, time);

    if (typeof window !== 'undefined' && 'performance' in window && performance.mark) {
      try {
        performance.mark(name);
      } catch {}
    }
  },

  measure(stepName: string, startMark: string, endMark: string) {
    const start = markers.get(startMark);
    const end = markers.get(endMark) || performance.now();

    let durationMs = 0;
    if (start !== undefined) {
      durationMs = +(end - start).toFixed(2);
    }

    if (
      typeof window !== 'undefined' &&
      'performance' in window &&
      performance.measure
    ) {
      try {
        performance.measure(stepName, startMark, endMark);
      } catch {}
    }

    console.log(`[Startup Audit] ${stepName}: ${durationMs}ms`);
    return durationMs;
  },

  log(stepName: string, durationMs: number) {
    console.log(`[Startup Audit] ${stepName}: ${durationMs.toFixed(2)}ms`);
  }
};
