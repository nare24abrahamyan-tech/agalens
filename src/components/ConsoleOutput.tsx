import { useEffect, useRef } from 'react';

interface Props {
  text: string;
  finished: boolean;
  returned?: string;
}

export default function ConsoleOutput({ text, finished, returned }: Props) {
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  return (
    <section className="panel" aria-label="Console output">
      <header className="panel-head">
        <h2>Console (stdout)</h2>
        {finished && <span className="tag">{returned !== undefined ? 'function finished' : 'program finished'}</span>}
      </header>
      <pre className="console" ref={ref} aria-live="polite">
        {text === '' ? <span className="placeholder">(no output yet)</span> : text}
        {!finished && text !== '' && <span className="caret" />}
      </pre>
      {finished && returned !== undefined && (
        <p className="returned">
          <span>returned</span> <code>{returned}</code>
        </p>
      )}
    </section>
  );
}
