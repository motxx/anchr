import { CashuMint, CashuWallet, CheckStateEnum, type Proof, getEncodedToken, getDecodedToken } from "@cashu/cashu-ts";
import { useSettingsStore } from "../store/settings";

let _wallet: CashuWallet | null = null;
let _lastMintUrl: string | null = null;

export function getCashuWallet(): CashuWallet | null {
  const mintUrl = useSettingsStore.getState().mintUrl;
  if (!mintUrl) return null;

  if (!_wallet || _lastMintUrl !== mintUrl) {
    const mint = new CashuMint(mintUrl);
    _wallet = new CashuWallet(mint, { unit: "sat" });
    _lastMintUrl = mintUrl;
  }
  return _wallet;
}

export function getMintUrl(): string {
  return useSettingsStore.getState().mintUrl;
}

export async function createBountyToken(amountSats: number): Promise<{
  token: string;
  proofs: Proof[];
} | null> {
  const wallet = getCashuWallet();
  if (!wallet) return null;

  try {
    await wallet.loadMint();
    const mintQuote = await wallet.createMintQuote(amountSats);
    console.error(`[cashu] Pay this invoice to mint ${amountSats} sats: ${mintQuote.request}`);
    const proofs = await wallet.mintProofs(amountSats, mintQuote.quote);
    const token = getEncodedToken({ mint: getMintUrl(), proofs });
    return { token, proofs };
  } catch (error) {
    console.error("[cashu] Failed to create bounty token:", error instanceof Error ? error.message : error);
    return null;
  }
}

export function encodeToken(mintUrl: string, proofs: Proof[]): string {
  return getEncodedToken({ mint: mintUrl, proofs });
}

export async function verifyToken(token: string, expectedMinSats?: number): Promise<{
  valid: boolean;
  amountSats: number;
  error?: string;
}> {
  try {
    const decoded = getDecodedToken(token);
    const totalAmount = decoded.proofs.reduce((sum: number, p: Proof) => sum + p.amount, 0);

    if (expectedMinSats && totalAmount < expectedMinSats) {
      return { valid: false, amountSats: totalAmount, error: `Insufficient: ${totalAmount} < ${expectedMinSats}` };
    }

    const wallet = getCashuWallet();
    if (wallet) {
      try {
        await wallet.loadMint();
        const states = await wallet.checkProofsStates(decoded.proofs);
        const spent = states.filter((s) => s.state !== CheckStateEnum.UNSPENT);
        if (spent.length > 0) {
          return { valid: false, amountSats: totalAmount, error: `${spent.length} proof(s) already spent` };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { valid: false, amountSats: totalAmount, error: `Mint verification failed: ${msg}` };
      }
    }

    return { valid: true, amountSats: totalAmount };
  } catch (error) {
    return { valid: false, amountSats: 0, error: error instanceof Error ? error.message : "Invalid token" };
  }
}

export function decodeTokenAmount(token: string): number {
  try {
    const decoded = getDecodedToken(token);
    return decoded.proofs.reduce((sum: number, p: Proof) => sum + p.amount, 0);
  } catch {
    return 0;
  }
}

export function isCashuEnabled(): boolean {
  return !!useSettingsStore.getState().mintUrl;
}
