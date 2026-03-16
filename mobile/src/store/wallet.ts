import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface WalletTransaction {
  id: string;
  queryId: string;
  description: string;
  amountSats: number;
  cashuToken: string;
  timestamp: number;
}

interface WalletState {
  balance: number;
  transactions: WalletTransaction[];
  addEarning: (tx: Omit<WalletTransaction, "id" | "timestamp">) => void;
  load: () => Promise<void>;
}

const STORAGE_KEY = "anchr_wallet_transactions";

function computeBalance(txs: WalletTransaction[]): number {
  return txs.reduce((sum, tx) => sum + tx.amountSats, 0);
}

export const useWalletStore = create<WalletState>((set, get) => ({
  balance: 0,
  transactions: [],

  addEarning: (tx) => {
    const entry: WalletTransaction = {
      ...tx,
      id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
    };
    const updated = [entry, ...get().transactions];
    set({ transactions: updated, balance: computeBalance(updated) });
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  },

  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const txs = JSON.parse(raw) as WalletTransaction[];
        set({ transactions: txs, balance: computeBalance(txs) });
      }
    } catch (e) {
      console.error("[anchr-wallet] load error:", e);
    }
  },
}));
