interface Props {
  index: number;
  total: number;
  playing: boolean;
  delay: number;
  disabled: boolean;
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onReset: () => void;
  onSeek: (index: number) => void;
  onDelay: (ms: number) => void;
}

export default function Controls({
  index, total, playing, delay, disabled, onPlayPause, onNext, onPrev, onReset, onSeek, onDelay,
}: Props) {
  const atEnd = index >= total - 1;
  return (
    <div className="controls" role="group" aria-label="Playback controls">
      <div className="controls-row">
        <button className="btn" onClick={onReset} disabled={disabled || index === 0} title="Back to the first step (Home)">
          ⏮ Reset
        </button>
        <button className="btn" onClick={onPrev} disabled={disabled || index === 0} title="Previous step (←)">
          ◀ Prev
        </button>
        <button className="btn btn-primary" onClick={onPlayPause} disabled={disabled} title="Play / Pause (Space)">
          {playing ? '⏸ Pause' : atEnd && total > 0 ? '↻ Replay' : '▶ Play'}
        </button>
        <button className="btn" onClick={onNext} disabled={disabled || atEnd} title="Next step (→)">
          Next ▶
        </button>
        <label className="speed" title="Delay between steps while playing">
          <span>Delay</span>
          <input
            type="range"
            min={200}
            max={1500}
            step={50}
            value={delay}
            onChange={(e) => onDelay(Number(e.target.value))}
            aria-label="Playback delay in milliseconds"
          />
          <span className="speed-value">{delay} ms</span>
        </label>
      </div>
      <div className="scrub-row">
        <span className="step-counter" aria-live="polite">
          {total > 0 ? `Step ${index + 1} of ${total}` : 'No steps yet'}
        </span>
        <input
          className="scrubber"
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={Math.min(index, Math.max(0, total - 1))}
          disabled={disabled || total === 0}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label="Step progress"
        />
      </div>
    </div>
  );
}
