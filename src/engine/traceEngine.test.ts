import { describe, expect, it } from 'vitest';
import { analyzeProgram, generateTrace, suggestCall } from './traceEngine';
import { SAMPLES } from './samples';
import type { ArrayVar, ScalarVar } from './types';

const last = <T,>(a: T[]): T => a[a.length - 1];
const out = (code: string, stdin = '') => last(generateTrace(code, { stdin }).steps).stdout;
const wrap = (body: string) => `#include <iostream>\nusing namespace std;\nint main() {\n${body}\nreturn 0;\n}\n`;

describe('sample programs', () => {
  const expected: Record<string, string> = {
    'bubble-sort': 'Sorted array: 11 12 22 25 34 64 90 \n',
    'array-reversal': 'Reversed: 6 5 4 3 2 1\n',
    'two-sum': 'Indices: 0 1\n',
    'linear-search': 'Found 7 at index 4\n',
    'binary-search': 'Index of 23: 5\n',
    'insertion-sort': '1 3 4 5 7 8 9 \n',
    'fibonacci-dp': 'fib(10) = 55\n',
    'matrix-2d': 'Sum = 60\n',
    factorial: '5! = 120\n',
    'max-subarray': '',
  };

  for (const s of SAMPLES) {
    it(`${s.name} produces the correct output and a valid trace`, () => {
      const t = generateTrace(s.code, { stdin: s.stdin, entryCall: s.entryCall });
      expect(t.error).toBeUndefined();
      expect(t.status).toBe('finished');
      expect(t.steps.length).toBeGreaterThan(3);
      expect(last(t.steps).status).toBe('finished');
      expect(last(t.steps).stdout).toBe(expected[s.id]);
      t.steps.forEach((st, i) => {
        expect(st.step).toBe(i + 1);
        expect(st.line).toBeGreaterThan(0);
      });
    });
  }

  it('bubble sort trace records the array state and swap highlights', () => {
    const s = SAMPLES.find((x) => x.id === 'bubble-sort')!;
    const t = generateTrace(s.code);
    const fin = last(t.steps).variables.find((v) => v.name === 'arr') as ArrayVar;
    expect(fin.rows[0].map((c) => c.n)).toEqual([11, 12, 22, 25, 34, 64, 90]);
    const init = t.steps.find((st) => st.variables.some((v) => v.name === 'arr'))!;
    expect((init.variables.find((v) => v.name === 'arr') as ArrayVar).rows[0].map((c) => c.n)).toEqual([64, 34, 25, 12, 22, 11, 90]);
    expect(t.steps.some((st) => st.highlights.some((h) => h.kind === 'write'))).toBe(true);
    expect(t.steps.some((st) => st.highlights.some((h) => h.kind === 'read'))).toBe(true);
  });

  it('swap() highlights both cells as swap', () => {
    const s = SAMPLES.find((x) => x.id === 'array-reversal')!;
    const t = generateTrace(s.code, { stdin: s.stdin });
    expect(t.steps.some((st) => st.highlights.filter((h) => h.kind === 'swap').length === 2)).toBe(true);
  });

  it('recursion shows a growing call stack', () => {
    const s = SAMPLES.find((x) => x.id === 'factorial')!;
    const t = generateTrace(s.code);
    expect(Math.max(...t.steps.map((st) => st.depth))).toBe(6);
  });
});

describe('language features', () => {
  it('integer vs floating arithmetic', () => {
    expect(out(wrap('cout << 7/2 << " " << 7%3 << " " << 7/2.0 << " " << (double)7/2 << endl;'))).toBe('3 1 3.5 3.5\n');
  });
  it('char, bool and casts', () => {
    expect(out(wrap("char c = 'a'; c++; cout << c << (int)c << (c=='b') << endl;"))).toBe('b981\n');
  });
  it('int overflow wraps on assignment', () => {
    expect(out(wrap('int x = 2147483647; x = x + 1; cout << x << endl;'))).toBe('-2147483648\n');
  });
  it('strings', () => {
    expect(out(wrap('string s = "ab"; s += "cd"; s.push_back(\'e\'); cout << s << s.size() << s[1] << endl;'))).toBe('abcde5b\n');
  });
  it('vectors, 2D vectors and range-for', () => {
    const o = out(wrap(`vector<vector<int>> g(2, vector<int>(3, 1)); g[1][2] = 5; int s = 0; for (auto& r : g) for (int x : r) s += x; cout << s << endl;`).replace('<iostream>', '<iostream>\n#include <vector>'));
    expect(o).toBe('10\n');
  });
  it('functions with reference params', () => {
    const code = `#include <iostream>
using namespace std;
void inc(int &x) { x += 10; }
void sw(int &a, int &b) { int t = a; a = b; b = t; }
int main() { int a = 1, b = 2; inc(a); int arr[2] = {5, 6}; sw(arr[0], arr[1]); cout << a << " " << arr[0] << arr[1] << endl; }`;
    expect(out(code)).toBe('11 65\n');
  });
  it('cin in a while loop, getline-free', () => {
    const code = wrap('int x, sum = 0; while (cin >> x) sum += x; cout << sum << endl;');
    expect(out(code, '1 2 3\n4')).toBe('10\n');
  });
  it('doubles formatting, fixed and setprecision', () => {
    expect(out(wrap('cout << 3.14159265 << " " << 1.0/3 << " " << 100000.0 << " " << 1e7 << endl;'))).toBe('3.14159 0.333333 100000 1e+07\n');
    expect(out(`#include <iostream>\n#include <iomanip>\nusing namespace std;\nint main(){ cout << fixed << setprecision(2) << 3.14159 << endl; }`)).toBe('3.14\n');
  });
  it('sort and reverse on vector and array', () => {
    const code = `#include <bits/stdc++.h>
using namespace std;
int main() { vector<int> v = {3,1,2}; sort(v.begin(), v.end()); int a[4] = {4,3,2,1}; sort(a, a+4); reverse(v.begin(), v.end());
 for (int x : v) cout << x; cout << " "; for (int i = 0; i < 4; i++) cout << a[i]; cout << endl; }`;
    expect(out(code)).toBe('321 1234\n');
  });
  it('printf', () => {
    expect(out(wrap('printf("%d-%5.2f-%s-%c\\n", 5, 3.14159, "hi", \'z\');'))).toBe('5- 3.14-hi-z\n');
  });
  it('typedef, define, ternary, do-while, ios tuning lines', () => {
    const code = `#include <bits/stdc++.h>
#define N 5
typedef long long ll;
using namespace std;
int main() { ios::sync_with_stdio(false); cin.tie(nullptr); ll s = 0; int i = 0; do { s += i % 2 ? i : -i; i++; } while (i < N); cout << s << endl; }`;
    expect(out(code)).toBe('-2\n'.replace('-2', String(0 - 0 + (-0) + 1 - 2 + 3 - 4)));
  });
  it('continue / break in nested loops', () => {
    expect(out(wrap('int c = 0; for (int i = 0; i < 5; i++) { if (i == 1) continue; if (i == 4) break; c += i; } cout << c << endl;'))).toBe('5\n');
  });
});

describe('errors and limits', () => {
  it('reports compile errors with line numbers', () => {
    const t = generateTrace('int main() {\n  int x = ;\n}\n');
    expect(t.status).toBe('error');
    expect(t.error?.kind).toBe('compile');
    expect(t.error?.line).toBe(2);
  });
  it('reports missing semicolons', () => {
    const t = generateTrace('int main() {\n  int x = 1\n  return 0;\n}\n');
    expect(t.error?.kind).toBe('compile');
  });
  it('reports undeclared variables as an error step', () => {
    const t = generateTrace(wrap('cout << y;'));
    expect(t.status).toBe('error');
    expect(t.error?.kind).toBe('runtime');
    expect(t.error?.message).toContain("'y'");
    expect(last(t.steps).status).toBe('error');
  });
  it('reports out-of-range array access', () => {
    const t = generateTrace(wrap('int a[3]; a[3] = 1;'));
    expect(t.error?.message).toContain('out of range');
  });
  it('reports division by zero', () => {
    const t = generateTrace(wrap('int z = 0; cout << 1 / z;'));
    expect(t.error?.message).toContain('division by zero');
  });
  it('stops infinite loops at the step cap', () => {
    const t = generateTrace(wrap('int i = 0; while (true) { i++; }'));
    expect(t.status).toBe('limit');
    expect(t.steps.length).toBe(10_000);
    expect(last(t.steps).status).toBe('limit');
    expect(t.error?.kind).toBe('limit');
  });
  it('honours a higher step limit', () => {
    const t = generateTrace(wrap('int s = 0; for (int i = 0; i < 6000; i++) s += i; cout << s;'), { maxSteps: 50_000 });
    expect(t.status).toBe('finished');
    expect(t.steps.length).toBeGreaterThan(10_000);
  });
  it('catches runaway recursion', () => {
    const t = generateTrace('#include <iostream>\nint f(int n) { return f(n + 1); }\nint main() { f(0); }');
    expect(t.error?.message).toContain('stack overflow');
  });
  it('rejects unsupported features with a clear message', () => {
    const t = generateTrace('struct P { int x; };\nint main() { }');
    expect(t.error?.kind).toBe('compile');
    expect(t.error?.message).toContain('not supported');
  });
  it('is fast for typical programs', () => {
    const s = SAMPLES.find((x) => x.id === 'bubble-sort')!;
    const t = generateTrace(s.code);
    expect(t.elapsedMs).toBeLessThan(2000);
  });
  it('flags changed scalars between steps', () => {
    const t = generateTrace(wrap('int x = 1; x = 2;'));
    const stepsWithX = t.steps.filter((s) => s.variables.some((v) => v.name === 'x'));
    const v = (i: number) => stepsWithX[i].variables.find((x) => x.name === 'x') as ScalarVar;
    expect(v(1).changed).toBe(true);
  });
});

describe('function-only snippets (no main)', () => {
  const kadane = `int maxSubarraySum(vector<int> &arr) {
    // Code here
    int max_array = INT_MIN;
    int sum = 0;

    for (int num : arr) {
        if (sum < 0) {
            sum = 0;
        }

        sum += num;
        max_array = max(sum, max_array);
    }
    return max_array;
}`;

  it('runs a bare function with no includes, no using namespace and no main', () => {
    const t = generateTrace(kadane, { entryCall: 'maxSubarraySum({-2, 1, -3, 4, -1, 2, 1, -5, 4})' });
    expect(t.error).toBeUndefined();
    expect(t.status).toBe('finished');
    expect(t.returnValue).toBe('6');
    const fin = last(t.steps);
    expect(fin.status).toBe('finished');
    expect(fin.message).toBe('Returned 6');
    expect(fin.variables.some((v) => v.name === 'max_array')).toBe(true);
    expect(fin.variables.find((v) => v.name === 'arr')?.kind).toBe('array');
  });

  it('handles all-negative input and a single element', () => {
    expect(generateTrace(kadane, { entryCall: 'maxSubarraySum({-3, -1, -2})' }).returnValue).toBe('-1');
    expect(generateTrace(kadane, { entryCall: 'maxSubarraySum({7})' }).returnValue).toBe('7');
  });

  it('suggests a runnable default call', () => {
    const info = analyzeProgram(kadane)!;
    expect(info.hasMain).toBe(false);
    expect(info.functions.map((f) => f.name)).toEqual(['maxSubarraySum']);
    const call = suggestCall(info.functions[0]);
    expect(generateTrace(kadane, { entryCall: call }).returnValue).toBe('6');
  });

  it('works with scalar, string and array parameters and recursion', () => {
    const code = `int fib(int n) { if (n < 2) return n; return fib(n - 1) + fib(n - 2); }
int sum(int a[], int n) { int s = 0; for (int i = 0; i < n; i++) s += a[i]; return s; }
string rev(string s) { string r = ""; for (int i = s.size() - 1; i >= 0; i--) r += s[i]; return r; }`;
    expect(generateTrace(code, { entryCall: 'fib(10)' }).returnValue).toBe('55');
    expect(generateTrace(code, { entryCall: 'sum({1, 2, 3, 4}, 4)' }).returnValue).toBe('10');
    expect(generateTrace(code, { entryCall: 'rev("abc")' }).returnValue).toBe('"cba"');
  });

  it('explains what is missing', () => {
    expect(generateTrace(kadane).error?.message).toContain('No main()');
    expect(generateTrace(kadane, { entryCall: 'nope(1)' }).error?.message).toContain('must call one of your functions');
    expect(generateTrace(kadane, { entryCall: 'maxSubarraySum({1,' }).error?.kind).toBe('compile');
    expect(generateTrace(kadane, { entryCall: 'maxSubarraySum()' }).error).toBeDefined();
  });

  it('still prefers main() when it exists', () => {
    const t = generateTrace(wrap('cout << 1;'), { entryCall: 'foo()' });
    expect(t.status).toBe('finished');
    expect(t.returnValue).toBeUndefined();
  });
});
