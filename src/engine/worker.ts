import { generateTrace } from './traceEngine';
import type { RunOptions, TraceResult } from './types';

export interface WorkerRequest {
  id: number;
  source: string;
  options: Partial<RunOptions>;
}

export interface WorkerResponse {
  id: number;
  result: TraceResult;
}

interface WorkerScope {
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(msg: WorkerResponse): void;
}

const ctx = self as unknown as WorkerScope;

ctx.onmessage = (ev) => {
  const { id, source, options } = ev.data;
  ctx.postMessage({ id, result: generateTrace(source, options) });
};
