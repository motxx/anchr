# @anchr/core-runtime

Thin runtime compatibility layer for the Deno / Bun ↔ Node.js boundary: runtime
detection, process spawning, file I/O, `which`, and module-directory lookup.

This package is part of the Anchr ecosystem but has **zero dependencies** and is
usable in any Deno project that needs the same compat surface.

## Install

```jsonc
// deno.json
{
  "imports": {
    "@anchr/core-runtime": "jsr:@anchr/core-runtime@^0.1"
  }
}
```

In a workspace alongside other Anchr packages, use a relative path:

```jsonc
{
  "imports": {
    "@anchr/core-runtime": "../core-runtime/src/mod.ts"
  }
}
```

## Public API

```typescript
import {
  detectRuntimeTarget,
  fileExists,
  fileLastModified,
  moduleDir,
  readFile,
  readFileAsArrayBuffer,
  spawn,
  type SpawnOptions,
  type SpawnResult,
  which,
  writeFile,
} from "@anchr/core-runtime";
```

Each helper is also available as a separate sub-export
(`@anchr/core-runtime/process`, `/fs`, `/which`, `/env`, `/runtime`) for
finer-grained imports. `moduleDir()` avoids `node:path`, so browser bundles can
tree-shake the runtime helpers they do not call.

## Tests

```bash
deno task test
```

Unit tests cover the browser-safe `moduleDir()` path handling and runtime
detection.

## License

MIT
