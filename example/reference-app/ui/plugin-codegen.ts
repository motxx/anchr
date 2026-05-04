interface PluginCodeQuery {
  id: string;
  description: string;
  tlsn_requirements?: {
    target_url: string;
    conditions?: { type: string; expression: string; description?: string }[];
  } | null;
  tlsn_verifier_url?: string | null;
  tlsn_proxy_url?: string | null;
}

export function generatePluginCode(query: PluginCodeQuery, apiOrigin: string): string {
  const req = query.tlsn_requirements;
  if (!req) return "";
  const url = req.target_url;
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = url;
  }

  const verifierUrl = query.tlsn_verifier_url || "ws://localhost:7048";
  const proxyUrl = query.tlsn_proxy_url || `ws://localhost:7048/proxy?token=${hostname}`;

  return `// Anchr plugin — auto-proves and submits
const QUERY_ID = '${query.id}';
const API = '${apiOrigin}';
const VERIFIER_URL = '${verifierUrl}';
const PROXY_URL = '${proxyUrl}';

export default {
  config: {
    name: 'Anchr: ${hostname}',
    description: '${query.description.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}',
    requests: [{
      method: 'GET',
      host: '${hostname}',
      pathname: '/**',
      verifierUrl: VERIFIER_URL,
    }],
  },
  main: async () => {
    const proof = await prove(
      {
        url: '${url}',
        method: 'GET',
        headers: {
          'Host': '${hostname}',
          'User-Agent': 'anchr-worker/1.0',
          'Accept': 'application/json',
          'Accept-Encoding': 'identity',
          'Connection': 'close',
        },
      },
      {
        verifierUrl: VERIFIER_URL,
        proxyUrl: PROXY_URL,
        maxRecvData: 16384,
        maxSentData: 4096,
        handlers: [
          { type: 'SENT', part: 'START_LINE', action: 'REVEAL' },
          { type: 'RECV', part: 'STATUS_CODE', action: 'REVEAL' },
          { type: 'RECV', part: 'BODY', action: 'REVEAL' },
        ],
      }
    );

    // Copy result for pasting into Anchr Worker page
    try {
      await navigator.clipboard.writeText(JSON.stringify(proof));
      console.log('[Anchr] Result copied to clipboard — paste it in the Worker page');
    } catch (e) {
      console.log('[Anchr] Copy to clipboard:', JSON.stringify(proof));
    }

    done(proof);
  },
};`;
}
