# @anchr/core-runtime

Thin runtime compatibility layer for the Deno / Bun ↔ Node.js boundary: process spawning, file I/O, `which`, and module-directory lookup.

This package is part of the Anchr ecosystem but has **zero dependencies** and is usable in any Deno project that needs the same compat surface.

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
  spawn, type SpawnOptions, type SpawnResult,
  readFile, writeFile, fileExists, fileLastModified, readFileAsArrayBuffer,
  which,
  moduleDir,
} from "@anchr/core-runtime";
```

Each helper is also available as a separate sub-export (`@anchr/core-runtime/process`, `/fs`, `/which`, `/env`) for finer-grained imports.

## Tests

```bash
deno task test
```

(This package has no test fixtures — tested transitively by consumers.)

## License

MIT
