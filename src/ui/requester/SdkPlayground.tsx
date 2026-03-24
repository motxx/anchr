import { Copy, Check, Terminal, Globe, Camera } from "lucide-react";
import React, { useState } from "react";
import { API_BASE } from "../api-config";

function CodeBlock({ code, language = "typescript" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      <pre className="bg-black/50 rounded-lg p-4 overflow-x-auto text-[13px] leading-relaxed">
        <code className="text-emerald-300 font-mono">{code}</code>
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded-md bg-white/5 hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-emerald-400" />
        ) : (
          <Copy className="w-3.5 h-3.5 text-muted-foreground" />
        )}
      </button>
    </div>
  );
}

const serverUrl = API_BASE || window.location.origin;

const SDK_EXAMPLES = [
  {
    title: "Web Data Verification",
    description: "Prove what any HTTPS API returned — cryptographically verified via TLSNotary.",
    icon: Globe,
    code: `import { Anchr } from "anchr-sdk";

const anchr = new Anchr({ serverUrl: "${serverUrl}" });

const result = await anchr.query({
  description: "BTC price from CoinGecko",
  targetUrl: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
  conditions: [{ type: "jsonpath", expression: "bitcoin.usd" }],
  maxSats: 21,
});

console.log(result.verified);    // true
console.log(result.data);        // { bitcoin: { usd: 71000 } }
console.log(result.serverName);  // "api.coingecko.com"`,
  },
  {
    title: "Photo Verification",
    description: "Buy a verified photo of a location — C2PA signed with GPS + timestamp.",
    icon: Camera,
    code: `import { Anchr } from "anchr-sdk";

const anchr = new Anchr({ serverUrl: "${serverUrl}" });

const result = await anchr.photo({
  description: "Shibuya Scramble Crossing right now",
  locationHint: "Shibuya, Tokyo",
  expectedGps: { lat: 35.6595, lon: 139.7004 },
  maxGpsDistanceKm: 0.5,
  maxSats: 100,
});

console.log(result.verified);      // true
console.log(result.attachments);   // [{ uri, mimeType }]`,
  },
  {
    title: "cURL — Create Query",
    description: "Create a TLSNotary query directly via the REST API.",
    icon: Terminal,
    code: `curl -X POST ${serverUrl}/queries \\
  -H "Content-Type: application/json" \\
  -d '{
    "description": "BTC price from CoinGecko",
    "verification_requirements": ["tlsn"],
    "tlsn_requirements": {
      "target_url": "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      "conditions": [{"type": "jsonpath", "expression": "bitcoin.usd"}]
    },
    "bounty": {"amount_sats": 21}
  }'`,
  },
];

export function SdkPlayground() {
  return (
    <div className="space-y-6">
      {/* Install */}
      <div className="bg-card rounded-lg border border-border p-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Install</p>
        <CodeBlock code="bun add anchr-sdk" language="bash" />
      </div>

      {/* Examples */}
      {SDK_EXAMPLES.map((ex, i) => (
        <div key={i} className="bg-card rounded-lg border border-border p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <ex.icon className="w-4 h-4 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">{ex.title}</p>
          </div>
          <p className="text-xs text-muted-foreground mb-3">{ex.description}</p>
          <CodeBlock code={ex.code} />
        </div>
      ))}

      {/* QueryResult shape */}
      <div className="bg-card rounded-lg border border-border p-4">
        <p className="text-sm font-semibold text-foreground mb-1.5">QueryResult</p>
        <p className="text-xs text-muted-foreground mb-3">
          Every field is cryptographically derived from the TLSNotary presentation — no self-reported data.
        </p>
        <CodeBlock code={`{
  verified: true,
  serverName: "api.coingecko.com",   // from TLS certificate
  data: { bitcoin: { usd: 71000 } }, // parsed response body
  rawBody: '{"bitcoin":{"usd":71000}}',
  proof: "base64...",                 // TLSNotary presentation
  timestamp: 1774360000,
  checks: [
    "TLSNotary: presentation signature valid",
    "TLSNotary: server name matches target",
    "TLSNotary: attestation fresh (< 300s)",
    "TLSNotary: condition passed: bitcoin.usd"
  ],
  satsPaid: 21,
  queryId: "query_..."
}`} />
      </div>

      {/* Links */}
      <div className="flex gap-3 text-xs">
        <a href="https://github.com/motxx/anchr" target="_blank" rel="noopener" className="text-blue-400 hover:underline">
          GitHub
        </a>
        <a href="https://www.npmjs.com/package/anchr-sdk" target="_blank" rel="noopener" className="text-blue-400 hover:underline">
          npm
        </a>
      </div>
    </div>
  );
}
