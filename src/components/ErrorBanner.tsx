import type { TraceError } from '../engine/types';

interface Props {
  error: TraceError;
  stepsLimit: number;
  canRaiseLimit: boolean;
  onRaiseLimit: () => void;
  onDismiss: () => void;
}

const TITLES: Record<TraceError['kind'], string> = {
  compile: 'Compile error',
  runtime: 'Runtime error',
  limit: 'Execution limit reached',
};

export default function ErrorBanner({ error, stepsLimit, canRaiseLimit, onRaiseLimit, onDismiss }: Props) {
  return (
    <div className={`banner banner-${error.kind}`} role="alert">
      <div className="banner-body">
        <strong>
          {TITLES[error.kind]}
          {error.line ? ` (line ${error.line})` : ''}
        </strong>
        <span>{error.message}</span>
        {error.kind === 'limit' && (
          <span className="banner-hint">
            Showing the first {stepsLimit.toLocaleString('en-US')} steps. Long algorithms may simply need a higher limit.
          </span>
        )}
      </div>
      <div className="banner-actions">
        {error.kind === 'limit' && canRaiseLimit && (
          <button className="btn btn-small" onClick={onRaiseLimit}>
            Run with a higher limit
          </button>
        )}
        <button className="btn btn-small btn-ghost" onClick={onDismiss} aria-label="Dismiss message">
          ✕
        </button>
      </div>
    </div>
  );
}
