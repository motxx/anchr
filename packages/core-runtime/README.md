# core-runtime

Thin runtime compatibility layer (Bun ↔ Deno equivalents) for `spawn`, file ops, `which`, and `moduleDir`.

## Status

🚧 **WIP — extracted from anchr monorepo (2026-04-26)**

## Public API

```typescript
import { spawn, readFile, writeFile, fileExists, fileLastModified, readFileAsArrayBuffer, which, moduleDir } from "core-runtime/mod";
```

## License

MIT
