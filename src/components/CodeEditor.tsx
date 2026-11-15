import { useEffect, useRef } from 'react';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { cpp } from '@codemirror/lang-cpp';
import { oneDark } from '@codemirror/theme-one-dark';

interface Marks {
  active: number | null;
  error: number | null;
}

const setMarks = StateEffect.define<Marks>();

const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const ef of tr.effects) {
      if (!ef.is(setMarks)) continue;
      const ranges = [];
      const doc = tr.state.doc;
      const { active, error } = ef.value;
      if (error && error >= 1 && error <= doc.lines) {
        ranges.push(Decoration.line({ class: 'cm-errorLine' }).range(doc.line(error).from));
      }
      if (active && active >= 1 && active <= doc.lines && active !== error) {
        ranges.push(Decoration.line({ class: 'cm-activeStep' }).range(doc.line(active).from));
      }
      return Decoration.set(ranges, true);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13.5px' },
  '.cm-scroller': { fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", lineHeight: '1.55' },
  '.cm-activeStep': { backgroundColor: 'rgba(88, 166, 255, 0.22)', boxShadow: 'inset 3px 0 0 #58a6ff' },
  '.cm-errorLine': { backgroundColor: 'rgba(248, 81, 73, 0.22)', boxShadow: 'inset 3px 0 0 #f85149' },
});

interface Props {
  value: string;
  onChange: (code: string) => void;
  activeLine: number | null;
  errorLine: number | null;
}

export default function CodeEditor({ value, onChange, activeLine, errorLine }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          cpp(),
          oneDark,
          theme,
          marksField,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // external value changes (e.g. choosing a sample)
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== value) v.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
  }, [value]);

  // highlight the active line and keep it in view
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const effects: StateEffect<unknown>[] = [setMarks.of({ active: activeLine, error: errorLine })];
    const target = errorLine ?? activeLine;
    if (target && target >= 1 && target <= v.state.doc.lines) {
      effects.push(EditorView.scrollIntoView(v.state.doc.line(target).from, { y: 'nearest', yMargin: 48 }));
    }
    v.dispatch({ effects });
  }, [activeLine, errorLine, value]);

  return <div className="editor-host" ref={host} aria-label="C++ code editor" />;
}
