# core-runtime

Thin runtime compatibility layer (Bun ↔ Deno equivalents) used by all Anchr packages.

## Scope

- `spawn` — process spawning with stdin/stdout/stderr piping
- `readFile`, `writeFile`, `fileExists`, `fileLastModified`, `readFileAsArrayBuffer` — file I/O
- `which` — `PATH` binary lookup
- `moduleDir(import.meta)` — current module's directory

## Public API

```typescript
import {
  spawn, type SpawnOptions, type SpawnResult,
  readFile, writeFile, fileExists, fileLastModified, readFileAsArrayBuffer,
  which,
  moduleDir,
} from "core-runtime/mod";
```

Each helper is also available as a separate file (`core-runtime/process`, `core-runtime/fs`, etc.) for tree-shaking.

## License

MIT
