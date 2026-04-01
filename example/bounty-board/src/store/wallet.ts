import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Proof } from "@cashu/cashu-ts";

export type TransactionType = "fund" | "earn" | "spend" | "sweep";

export interface WalletTransaction {
  id: string;
  type: TransactionType;
  queryId?: string;
  description: string;
  amountSats: number;
  cashuToken?: string;
  timestamp: number;
  locationHint?: string;
}

interface WalletState {
  transactions: WalletTransaction[];
  proofs: Proof[];
  readonly balance: number;

  addTransaction: (tx: Omit<WalletTransaction, "id" | "timestamp">) => void;
  addProofs: (newProofs: Proof[]) => void;
  removeProofs: (proofsToRemove: Proof[]) => void;
  load: () => Promise<void>;
}

const STORAGE_KEY_TXS = "anchr_wallet_transactions";
const STORAGE_KEY_PROOFS = "anchr_wallet_proofs";

function computeBalance(proofs: Proof[]): number {
  return proofs.reduce((sum, p) => sum + p.amount, 0);
}

export const useWalletStore = create<WalletState>((set, get) => ({
  balance: 0,
  transactions: [],
  proofs: [],

  addTransaction: (tx) => {
    if (tx.queryId && get().transactions.some((t) => t.queryId === tx.queryId && t.type === tx.type)) return;

    const entry: WalletTransaction = {
      ...tx,
      id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
    };
    const updated = [entry, ...get().transactions];
    set({ transactions: updated });
    AsyncStorage.setItem(STORAGE_KEY_TXS, JSON.stringify(updated));
  },

  addProofs: (newProofs) => {
    const updated = [...get().proofs, ...newProofs];
    set({ proofs: updated, balance: computeBalance(updated) });
    AsyncStorage.setItem(STORAGE_KEY_PROOFS, JSON.stringify(updated));
  },

  removeProofs: (proofsToRemove) => {
    const removeSet = new Set(proofsToRemove.map((p) => p.C));
    const updated = get().proofs.filter((p) => !removeSet.has(p.C));
    set({ proofs: updated, balance: computeBalance(updated) });
    AsyncStorage.setItem(STORAGE_KEY_PROOFS, JSON.stringify(updated));
  },

  load: async () => {
    try {
      const [rawTxs, rawProofs] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY_TXS),
        AsyncStorage.getItem(STORAGE_KEY_PROOFS),
      ]);
      const txs = rawTxs ? (JSON.parse(rawTxs) as WalletTransaction[]) : [];
      const proofs = rawProofs ? (JSON.parse(rawProofs) as Proof[]) : [];
      set({ transactions: txs, proofs, balance: computeBalance(proofs) });
    } catch (e) {
      console.error("[wallet] load error:", e);
    }
  },
}));
