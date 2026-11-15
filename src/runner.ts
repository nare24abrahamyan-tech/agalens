import { generateTrace } from './engine/traceEngine';
import type { WorkerRequest, WorkerResponse } from './engine/worker';
import type { RunOptions, TraceResult } from './engine/types';

/**
 * Runs the tracer in a Web Worker so the UI never freezes, with a hard watchdog that terminates
 * the worker if it stops responding. Falls back to the main thread if Workers are unavailable.
 */
export class TraceRunner {
  private worker: Worker | null = null;
  private nextId = 1;

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    try {
      this.worker = new Worker(new URL('./engine/worker.ts', import.meta.url), { type: 'module' });
    } catch {
      this.worker = null;
    }
    return this.worker;
  }

  run(source: string, options: Partial<RunOptions>): Promise<TraceResult> {
    const worker = this.ensureWorker();
    if (!worker) {
      return new Promise((resolve) => setTimeout(() => resolve(generateTrace(source, options)), 0));
    }
    const id = this.nextId++;
    const watchdogMs = (options.maxMillis ?? 5000) + 5000;

    return new Promise<TraceResult>((resolve) => {
      const cleanup = () => {
        clearTimeout(timer);
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };
      const fail = (message: string) => {
        cleanup();
        this.terminate();
        resolve({ steps: [], status: 'error', error: { kind: 'runtime', message }, elapsedMs: watchdogMs });
      };
      const onMessage = (ev: MessageEvent<WorkerResponse>) => {
        if (ev.data.id !== id) return;
        cleanup();
        resolve(ev.data.result);
      };
      const onError = (ev: ErrorEvent) => fail(`The interpreter crashed: ${ev.message || 'unknown error'}`);
      const timer = setTimeout(() => fail('The interpreter did not respond in time and was stopped.'), watchdogMs);
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      const req: WorkerRequest = { id, source, options };
      worker.postMessage(req);
    });
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
