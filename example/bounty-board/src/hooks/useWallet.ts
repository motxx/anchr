import { useCallback } from "react";
import { useWalletStore } from "../store/wallet";
import { verifyToken, decodeTokenAmount } from "../cashu/wallet";
import { getDecodedToken } from "@cashu/cashu-ts";

export function useWallet() {
  const { balance, proofs, transactions, addTransaction, addProofs, removeProofs } = useWalletStore();

  const fundFromToken = useCallback(async (token: string) => {
    const result = await verifyToken(token);
    if (!result.valid) {
      throw new Error(result.error ?? "Invalid token");
    }

    const decoded = getDecodedToken(token);
    addProofs(decoded.proofs);
    addTransaction({
      type: "fund",
      description: `Funded ${result.amountSats} sats`,
      amountSats: result.amountSats,
      cashuToken: token,
    });

    return result.amountSats;
  }, [addProofs, addTransaction]);

  return {
    balance,
    proofs,
    transactions,
    fundFromToken,
    addTransaction,
    addProofs,
    removeProofs,
  };
}
