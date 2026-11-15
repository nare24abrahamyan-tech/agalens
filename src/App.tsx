import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeEditor from './components/CodeEditor';
import Controls from './components/Controls';
import ArrayView from './components/ArrayView';
import VariablesTable from './components/VariablesTable';
import ConsoleOutput from './components/ConsoleOutput';
import ErrorBanner from './components/ErrorBanner';
import { DEFAULT_SAMPLE, SAMPLES } from './engine/samples';
import { analyzeProgram, suggestCall } from './engine/traceEngine';
import { ArrayVar, DEFAULT_MAX_MILLIS, DEFAULT_MAX_STEPS, TraceResult } from './engine/types';
import { TraceRunner } from './runner';

const STEP_LIMITS = [DEFAULT_MAX_STEPS, 50_000, 100_000];

export default function App() {
  const [sampleId, setSampleId] = useState(DEFAULT_SAMPLE.id);
  const [code, setCode] = useState(DEFAULT_SAMPLE.code);
  const [stdin, setStdin] = useState(DEFAULT_SAMPLE.stdin);
  const [entryCall, setEntryCall] = useState(DEFAULT_SAMPLE.entryCall ?? '');
  const [ranEntry, setRanEntry] = useState('');
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [ranCode, setRanCode] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [delay, setDelay] = useState(600);
  const [maxSteps, setMaxSteps] = useState(DEFAULT_MAX_STEPS);
  const [running, setRunning] = useState(false);
  const [errorDismissed, setErrorDismissed] = useState(false);

  const runner = useRef<TraceRunner | null>(null);
  if (!runner.current) runner.current = new TraceRunner();
  useEffect(() => () => runner.current?.terminate(), []);

  const total = trace?.steps.length ?? 0;
  const step = trace && total > 0 ? trace.steps[Math.min(index, total - 1)] : null;
  // Function-only code (no main): the user supplies the call to run.
  const info = useMemo(() => analyzeProgram(code), [code]);
  const needsCall = !!info && !info.hasMain && info.functions.length > 0;
  const signature = needsCall ? info!.functions.map((f) => `${f.name}(${f.params.map((p) => p.name).join(',')})`).join('|') : '';
  const lastSignature = useRef(signature);
  useEffect(() => {
    if (signature === lastSignature.current) return;
    lastSignature.current = signature;
    if (!needsCall) return;
    const target = info!.functions[info!.functions.length - 1];
    setEntryCall(suggestCall(target));
  }, [signature, needsCall, info]);

  const stale = ranCode !== null && (ranCode !== code || (needsCall && ranEntry !== entryCall));

  // ───── running ─────
  const run = useCallback(
    async (limit: number = maxSteps) => {
      setRunning(true);
      setPlaying(false);
      setErrorDismissed(false);
      const started = performance.now();
      const result = await runner.current!.run(code, {
        stdin,
        entryCall: needsCall ? entryCall : undefined,
        maxSteps: limit,
        maxMillis: DEFAULT_MAX_MILLIS,
      });
      setTrace(result);
      setRanCode(code);
      setRanEntry(entryCall);
      setIndex(0);
      setRunning(false);
      // eslint-disable-next-line no-console
      console.debug(`trace: ${result.steps.length} steps in ${Math.round(performance.now() - started)}ms`);
    },
    [code, stdin, maxSteps, entryCall, needsCall],
  );

  const raiseLimit = useCallback(() => {
    const next = STEP_LIMITS.find((l) => l > maxSteps) ?? maxSteps;
    setMaxSteps(next);
    void run(next);
  }, [maxSteps, run]);

  // ───── playback ─────
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setIndex((i) => Math.min(i + 1, Math.max(0, total - 1))), delay);
    return () => window.clearInterval(id);
  }, [playing, delay, total]);

  useEffect(() => {
    if (playing && total > 0 && index >= total - 1) setPlaying(false);
  }, [playing, index, total]);

  const next = useCallback(() => setIndex((i) => Math.min(i + 1, Math.max(0, total - 1))), [total]);
  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const reset = useCallback(() => {
    setPlaying(false);
    setIndex(0);
  }, []);
  const playPause = useCallback(() => {
    if (total === 0) return;
    if (playing) {
      setPlaying(false);
    } else {
      if (index >= total - 1) setIndex(0);
      setPlaying(true);
    }
  }, [playing, index, total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && el.closest('.cm-editor, input, textarea, select, button')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ') { e.preventDefault(); playPause(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setPlaying(false); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setPlaying(false); prev(); }
      else if (e.key === 'Home') { e.preventDefault(); reset(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playPause, next, prev, reset]);

  // ───── samples ─────
  const chooseSample = (id: string) => {
    const s = SAMPLES.find((x) => x.id === id);
    if (!s) return;
    setSampleId(id);
    setCode(s.code);
    setStdin(s.stdin);
    lastSignature.current = '';
    setEntryCall(s.entryCall ?? '');
    setTrace(null);
    setRanCode(null);
    setIndex(0);
    setPlaying(false);
    setErrorDismissed(false);
  };

  // ───── derived view state ─────
  const arrays = useMemo(() => (step ? (step.variables.filter((v) => v.kind === 'array') as ArrayVar[]) : []), [step]);
  const err = trace?.error;
  const showError = !!err && !errorDismissed && !stale;

  let activeLine: number | null = null;
  let errorLine: number | null = null;
  if (!stale && trace) {
    if (err?.kind === 'compile') errorLine = err.line ?? null;
    else if (step) {
      activeLine = step.line;
      if (step.status === 'error') errorLine = step.line;
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <i /><i /><i /><i />
          </span>
          <div>
            <h1>C++ Algorithm Visualizer</h1>
            <p>Paste code · press Run · step through it. Runs 100% in your browser.</p>
          </div>
        </div>
        <div className="topbar-actions">
          <label className="field">
            <span>Example</span>
            <select value={sampleId} onChange={(e) => chooseSample(e.target.value)} aria-label="Load an example program">
              {SAMPLES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              {sampleId === 'custom' && <option value="custom">Custom code</option>}
            </select>
          </label>
          <label className="field">
            <span>Step limit</span>
            <select value={maxSteps} onChange={(e) => setMaxSteps(Number(e.target.value))} aria-label="Maximum number of steps">
              {STEP_LIMITS.map((l) => (
                <option key={l} value={l}>
                  {l.toLocaleString('en-US')}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-run" onClick={() => void run()} disabled={running} aria-label="Run the program">
            {running ? 'Running…' : '▶ Run'}
          </button>
        </div>
      </header>

      <main className="layout">
        <section className="left">
          <div className="card editor-card">
            <div className="card-head">
              <h2>main.cpp</h2>
              {stale && <span className="tag tag-warn">code changed — press Run to refresh the trace</span>}
            </div>
            <CodeEditor
              value={code}
              onChange={(c) => {
                setCode(c);
                const match = SAMPLES.find((s) => s.code === c);
                setSampleId(match ? match.id : 'custom');
              }}
              activeLine={activeLine}
              errorLine={errorLine}
            />
          </div>
          {needsCall && (
            <div className="card call-card">
              <div className="card-head">
                <h2>Function call</h2>
                <span className="hint">no main() found: this call is what Run executes</span>
              </div>
              <input
                className="call-input mono"
                value={entryCall}
                onChange={(e) => setEntryCall(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void run(); }}
                spellCheck={false}
                placeholder="myFunction({1, 2, 3}, 5)"
                aria-label="Function call to run"
              />
              <p className="hint call-help">
                Pass vectors / arrays as <code>{'{1, 2, 3}'}</code>, strings as <code>"text"</code>. Defined:{' '}
                {info!.functions.map((f) => f.name).join(', ')}
              </p>
            </div>
          )}
          <div className="card stdin-card">
            <div className="card-head">
              <h2>Input (stdin)</h2>
              <span className="hint">read by cin / getline</span>
            </div>
            <textarea
              value={stdin}
              onChange={(e) => setStdin(e.target.value)}
              spellCheck={false}
              placeholder="Type the input your program reads with cin, e.g.  5  1 2 3 4 5"
              aria-label="Standard input"
              rows={3}
            />
          </div>
        </section>

        <section className="right">
          <Controls
            index={index}
            total={total}
            playing={playing}
            delay={delay}
            disabled={total === 0}
            onPlayPause={playPause}
            onNext={() => { setPlaying(false); next(); }}
            onPrev={() => { setPlaying(false); prev(); }}
            onReset={reset}
            onSeek={(i) => { setPlaying(false); setIndex(i); }}
            onDelay={setDelay}
          />

          {showError && err && (
            <ErrorBanner
              error={err}
              stepsLimit={maxSteps}
              canRaiseLimit={maxSteps < STEP_LIMITS[STEP_LIMITS.length - 1]}
              onRaiseLimit={raiseLimit}
              onDismiss={() => setErrorDismissed(true)}
            />
          )}

          {!trace && (
            <div className="card welcome">
              <h2>Ready when you are</h2>
              <p>
                Press <kbd>▶ Run</kbd> to execute the program and record a step-by-step trace. Then use Play, Next and Prev
                (or <kbd>←</kbd> <kbd>→</kbd> <kbd>Space</kbd>) to watch variables and arrays change line by line.
              </p>
              <SupportedSubset />
            </div>
          )}

          {trace && step && (
            <>
              <div className="step-caption">
                <span className="line-chip">line {step.line}</span>
                <span className="mono">{step.func === 'global' ? 'entry' : `${step.func}()`}</span>
                {step.message && <span className="muted">— {step.message}</span>}
                {stale && <span className="tag tag-warn">stale</span>}
              </div>

              <div className="card arrays">
                <div className="card-head">
                  <h2>Arrays</h2>
                  <Legend />
                </div>
                {arrays.length === 0 ? (
                  <p className="empty-note">No arrays or vectors in scope at this step.</p>
                ) : (
                  arrays.map((a) => <ArrayView key={`${a.scope}:${a.name}`} variable={a} highlights={step.highlights} />)
                )}
              </div>

              <div className="two-col">
                <VariablesTable variables={step.variables} func={step.func} stack={step.stack} />
                <ConsoleOutput text={step.stdout} finished={step.status === 'finished'} returned={step.status === 'finished' ? trace.returnValue : undefined} />
              </div>
            </>
          )}

          {trace && !step && !showError && (
            <div className="card welcome">
              <p>The program produced no steps.</p>
            </div>
          )}

          {trace && (
            <details className="card subset">
              <summary>Supported C++ subset</summary>
              <SupportedSubset />
            </details>
          )}
        </section>
      </main>
    </div>
  );
}

function Legend() {
  return (
    <div className="legend" aria-label="Legend">
      <span><i className="sw sw-read" /> read</span>
      <span><i className="sw sw-write" /> written</span>
      <span><i className="sw sw-swap" /> swapped</span>
    </div>
  );
}

function SupportedSubset() {
  return (
    <div className="subset-body">
      <p>
        This tracer is a purpose-built C++ interpreter that runs in your browser, so it supports a practical subset of the
        language (no server, no GDB):
      </p>
      <ul>
        <li><strong>Types:</strong> int, long long, unsigned, char, bool, float, double, string, vector&lt;T&gt;, 1D/2D arrays, typedef / using aliases.</li>
        <li><strong>Statements:</strong> if / else, for, range-for, while, do-while, break, continue, return, functions, recursion, reference parameters.</li>
        <li><strong>I/O:</strong> cin, cout, endl, getline, printf, setprecision, fixed.</li>
        <li><strong>Library:</strong> swap, min, max, abs, pow, sqrt, floor, ceil, sort, reverse, to_string, vector / string methods (size, push_back, back, substr, …).</li>
        <li><strong>Not yet supported:</strong> pointers, structs / classes, templates, switch, lambdas, map / set / queue / stack.</li>
      </ul>
    </div>
  );
}
