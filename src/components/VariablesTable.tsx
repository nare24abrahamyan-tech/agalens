import type { Variable } from '../engine/types';

interface Props {
  variables: Variable[];
  func: string;
  stack: string[];
}

function preview(v: Variable): string {
  if (v.kind === 'scalar') return v.value;
  const flat = v.rows.flatMap((r) => r.map((c) => c.s));
  const shown = flat.slice(0, 12).join(', ');
  return `[${shown}${flat.length > 12 || v.truncated ? ', …' : ''}]`;
}

export default function VariablesTable({ variables, func, stack }: Props) {
  return (
    <section className="panel" aria-label="Variables">
      <header className="panel-head">
        <h2>Variables</h2>
        {stack.length > 0 && (
          <span className="stack" title="Call stack">
            {stack.join(' › ')}
          </span>
        )}
      </header>
      {variables.length === 0 ? (
        <p className="empty-note">No variables in scope{func ? ` in ${func}()` : ''} yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="vars">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {variables.map((v) => (
                <tr key={`${v.scope}:${v.name}`} className={v.changed ? 'row-changed' : ''}>
                  <td className="mono name">
                    {v.name}
                    {v.scope === 'global' && <span className="tag">global</span>}
                  </td>
                  <td className="mono type">{v.type}</td>
                  <td className="mono value">{preview(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
