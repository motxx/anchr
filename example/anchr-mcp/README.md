# Anchr MCP adapter

MCP stdio adapter for agents that need to create, inspect, cancel, and submit
Anchr queries through tool calls. This is an adapter example, not part of the
Anchr protocol or actor SDK surface.

```sh
deno run --allow-all example/anchr-mcp/server.ts
```

The MCP server uses an in-process `QueryService` from `@anchr/bounty/flow`.
