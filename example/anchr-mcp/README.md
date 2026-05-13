# Anchr MCP adapter

MCP stdio adapter for agents that need to create, inspect, cancel, and submit
Anchr queries through tool calls. This is an adapter example, not part of the
Anchr protocol or actor SDK surface.

```sh
deno run --allow-all example/anchr-mcp/server.ts
```

Set `REMOTE_QUERY_API_BASE_URL` and `REMOTE_QUERY_API_KEY` to proxy tool calls
to a separately running HTTP adapter. Without those variables, the MCP server
uses an in-process `QueryService` from `@anchr/bounty`.
