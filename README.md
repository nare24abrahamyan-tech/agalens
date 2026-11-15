# C++ Algorithm Visualizer (MVP v0.2)

Paste C++ algorithm code, press **Run**, and step through an animated visualization of variables, arrays and
output. Everything runs in the browser as static files: no backend, no accounts, no hosting cost.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine tests (42 cases)
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/ locally
```

## Deploy to Netlify

`netlify.toml` is already configured (`npm run build`, publish `dist`, SPA redirect, asset caching).

1. Push this folder to a Git repository.
2. In Netlify choose **Add new site → Import from Git** and select the repo (build settings are read from `netlify.toml`).
3. Every push to `main` deploys automatically.

Or deploy once from the CLI: `npm run build && npx netlify deploy --prod --dir=dist`.

## How it works

JSCPP cannot produce per-statement variable and array snapshots, so this project ships its own small tracing
interpreter for a practical C++ subset (`src/engine/`):

| File | Role |
| --- | --- |
| `lexer.ts` / `parser.ts` | C++ subset → AST. Precise compile errors with line numbers |
| `interpreter.ts` | Tree-walking interpreter. Records a snapshot (line, variables, arrays, stdout, accessed cells) after every statement |
| `traceEngine.ts` | `generateTrace(source, { stdin, maxSteps })`: never throws, returns steps + status |
| `worker.ts` / `../runner.ts` | Runs the engine in a Web Worker with a watchdog so the UI never freezes |
| `samples.ts` | Bubble sort, array reversal, two sum, linear search, binary search, insertion sort, DP, 2D grid, recursion |

Safety limits: 10,000 steps (selectable up to 100,000), 5 s wall-clock, 200 call depth, 200k array elements,
200k characters of output.

## Function-only code (no `main`)

You can paste just a function, with no `#include`, `using namespace std` or `main()`. A **Function call** box appears
under the editor, pre-filled with an example call; edit it and press Run:

```cpp
int maxSubarraySum(vector<int> &arr) { ... }
```
```
maxSubarraySum({-2, 1, -3, 4, -1, 2, 1, -5, 4})      // -> returned 6
```

Pass vectors / arrays as `{1, 2, 3}` (nested `{{1, 2}, {3, 4}}`), strings as `"text"`. The return value is shown
under the console. If the code has a `main()`, the call box is hidden and `main()` runs as usual.

## Supported C++ subset

- **Types:** `int`, `long long`, `unsigned`, `char`, `bool`, `float`, `double`, `string`, `vector<T>` (nested too),
  1D/2D arrays, `auto`, `typedef` / `using` aliases, `#define NAME value`.
- **Statements:** `if/else`, `for`, range-`for`, `while`, `do-while`, `break`, `continue`, `return`, functions,
  recursion, reference parameters, array parameters.
- **I/O:** `cin >>`, `cout <<`, `endl`, `getline`, `printf`, `setprecision`, `fixed`.
- **Library:** `swap`, `min`, `max`, `abs`, `pow`, `sqrt`, `floor`, `ceil`, `round`, `log`, `gcd`, `sort`, `reverse`,
  `to_string`, `stoi`, `sizeof`; `vector`/`string` methods (`size`, `push_back`, `pop_back`, `back`, `front`,
  `resize`, `clear`, `insert`, `erase`, `substr`, `find`, ...).
- **Not yet supported** (reported with a clear error): pointers, `struct`/`class`, templates, `switch`, lambdas,
  `map`/`set`/`queue`/`stack`.

Notes: `int` arithmetic wraps to 32 bits on assignment; `long long` is exact up to 2^53; uninitialized variables
start at 0 (real C++ would show garbage); out-of-range indexing stops with a readable runtime error instead of
undefined behaviour.

## Keyboard shortcuts

`Space` play/pause, `←` / `→` previous/next step, `Home` reset (when focus is not in the editor).
