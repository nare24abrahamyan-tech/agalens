import type { ArrayVar, Highlight } from '../engine/types';

interface Props {
  variable: ArrayVar;
  highlights: Highlight[];
}

const KIND_CLASS = { read: 'hl-read', write: 'hl-write', swap: 'hl-swap' } as const;

export default function ArrayView({ variable, highlights }: Props) {
  const mine = highlights.filter((h) => h.name === variable.name);
  const kindAt = (row: number, col: number) => mine.find((h) => h.row === row && h.col === col)?.kind;
  const is2D = variable.rows.length > 1;

  return (
    <section className="array-card" aria-label={`Array ${variable.name}`}>
      <header className="array-head">
        <span className="array-name">{variable.name}</span>
        <span className="array-type">{variable.type}</span>
        <span className="array-len">{variable.length} element{variable.length === 1 ? '' : 's'}</span>
        {variable.scope === 'global' && <span className="tag">global</span>}
        {variable.truncated && <span className="tag tag-warn">showing first elements</span>}
      </header>
      {is2D ? <Grid variable={variable} kindAt={kindAt} /> : <Bars variable={variable} kindAt={kindAt} />}
    </section>
  );
}

type KindAt = (row: number, col: number) => Highlight['kind'] | undefined;

function Bars({ variable, kindAt }: { variable: ArrayVar; kindAt: KindAt }) {
  const cells = variable.rows[0] ?? [];
  if (cells.length === 0) return <p className="empty-note">empty</p>;

  const barW = Math.max(26, Math.min(64, Math.floor(720 / cells.length)));
  const gap = 6;
  const slot = barW + gap;
  const width = cells.length * slot + gap;
  const chartH = 150;
  const labelH = 44;
  const pad = 18;

  const nums = cells.map((c) => c.n);
  const max = Math.max(0, ...nums);
  const min = Math.min(0, ...nums);
  const span = max - min || 1;
  const scale = (chartH - pad) / span;
  const zeroY = pad + max * scale;
  const minBar = 3;

  return (
    <div className="array-scroll">
      <svg
        className="array-svg"
        width={width}
        height={chartH + labelH}
        viewBox={`0 0 ${width} ${chartH + labelH}`}
        role="img"
        aria-label={`${variable.name}: ${cells.map((c) => c.s).join(', ')}`}
      >
        <line x1={0} x2={width} y1={zeroY} y2={zeroY} className="axis" />
        {cells.map((c, i) => {
          const kind = kindAt(0, i);
          const h = Math.max(minBar, Math.abs(c.n) * scale);
          const y = c.n >= 0 ? zeroY - h : zeroY;
          const x = gap + i * slot;
          const cls = ['bar', kind ? KIND_CLASS[kind] : '', c.changed ? 'bar-changed' : ''].join(' ');
          return (
            <g key={i} className="bar-group" style={{ transform: `translate(${x}px, 0px)` }}>
              <rect className={cls} x={0} width={barW} rx={4} style={{ y, height: h }} />
              <text className="bar-value" x={barW / 2} y={c.n >= 0 ? Math.max(11, y - 5) : y + h + 12} textAnchor="middle">
                {truncate(c.s, 6)}
              </text>
              <rect
                className={['cell', kind ? KIND_CLASS[kind] : '', c.changed ? 'cell-changed' : ''].join(' ')}
                x={0}
                y={chartH + 4}
                width={barW}
                height={22}
                rx={4}
              />
              <text className="cell-text" x={barW / 2} y={chartH + 19} textAnchor="middle">
                {truncate(c.s, 5)}
              </text>
              <text className="cell-index" x={barW / 2} y={chartH + 40} textAnchor="middle">
                {i}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Grid({ variable, kindAt }: { variable: ArrayVar; kindAt: KindAt }) {
  const rows = variable.rows;
  const cols = Math.max(...rows.map((r) => r.length), 1);
  const cw = Math.max(34, Math.min(56, Math.floor(640 / cols)));
  const ch = 30;
  const left = 30;
  const top = 22;
  const width = left + cols * cw + 4;
  const height = top + rows.length * ch + 4;

  return (
    <div className="array-scroll">
      <svg className="array-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${variable.name} grid`}>
        {Array.from({ length: cols }, (_, c) => (
          <text key={`c${c}`} className="cell-index" x={left + c * cw + cw / 2} y={14} textAnchor="middle">
            {c}
          </text>
        ))}
        {rows.map((row, r) => (
          <g key={r}>
            <text className="cell-index" x={left - 8} y={top + r * ch + ch / 2 + 4} textAnchor="end">
              {r}
            </text>
            {row.map((cell, c) => {
              const kind = kindAt(r, c);
              return (
                <g key={c}>
                  <rect
                    className={['cell', 'grid-cell', kind ? KIND_CLASS[kind] : '', cell.changed ? 'cell-changed' : ''].join(' ')}
                    x={left + c * cw + 1}
                    y={top + r * ch + 1}
                    width={cw - 2}
                    height={ch - 2}
                    rx={4}
                  />
                  <text className="cell-text" x={left + c * cw + cw / 2} y={top + r * ch + ch / 2 + 4} textAnchor="middle">
                    {truncate(cell.s, 5)}
                  </text>
                </g>
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
