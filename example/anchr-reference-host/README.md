# Anchr reference host

Minimal deployment example: starts the standard Anchr host
(`worker-api` HTTP + MCP stdio + scheduler) backed by the
`@anchr/bounty` library.

```sh
deno task start          # run on :3000
HTTP_API_PORT=4000 deno task start
```

Most production deployments will outgrow this and switch to
`composeHost({ extraRoutes, ... })` to layer custom HTTP routes or MCP
tools on top — see `example/data-marketplace/server.ts` for a worked
example.
