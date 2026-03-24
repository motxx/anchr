/**
 * TLSNotary Plugin: CoinGecko BTC Price Verification
 *
 * Usage with TLSNotary Browser Extension:
 * 1. Install extension from Chrome Web Store
 * 2. Open extension DevConsole (extension popup → DevConsole)
 * 3. Paste this plugin code
 * 4. Click "Run"
 *
 * Configure verifier/proxy URLs below:
 */

// Change these to match your Verifier Server
const VERIFIER_URL = 'ws://localhost:7048';
const PROXY_URL = 'ws://localhost:7048/proxy?token=api.coingecko.com';

export default {
  config: {
    name: 'CoinGecko BTC Price',
    description: 'Prove Bitcoin USD price from CoinGecko API',
  },

  main: async () => {
    const proof = await prove(
      {
        url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
        method: 'GET',
        headers: {
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
          { type: 'RECV', part: 'HEADERS', action: 'REVEAL', params: { key: 'content-type' } },
          { type: 'RECV', part: 'BODY', action: 'REVEAL' },
        ],
      }
    );

    console.log('=== TLSNotary Proof ===');
    console.log('Request:', proof.results[0]?.value);
    console.log('Status:', proof.results[1]?.value);
    console.log('Content-Type:', proof.results[2]?.value);
    console.log('Body:', proof.results[3]?.value);
    console.log('======================');

    return proof;
  },
};
