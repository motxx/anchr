import React from "react";
import { View, FlatList } from "react-native";
import { DSCard, DSText, DSSatsAmount, DSDivider } from "../ds";
import { Ionicons } from "@expo/vector-icons";
import { formatShortTime } from "../../utils/time";
import type { WalletTransaction, TransactionType } from "../../store/wallet";

const TYPE_CONFIG: Record<TransactionType, { icon: string; color: string; prefix: string }> = {
  fund: { icon: "arrow-down-circle", color: "#3b82f6", prefix: "+" },
  earn: { icon: "flash", color: "#10b981", prefix: "+" },
  spend: { icon: "arrow-up-circle", color: "#f59e0b", prefix: "-" },
  sweep: { icon: "exit-outline", color: "#a1a1aa", prefix: "-" },
};

function TransactionRow({ tx }: { tx: WalletTransaction }) {
  const config = TYPE_CONFIG[tx.type];
  const isPositive = tx.type === "fund" || tx.type === "earn";

  return (
    <View className="flex-row items-center gap-3 px-4 py-3">
      <Ionicons name={config.icon as any} size={24} color={config.color} />
      <View className="flex-1">
        <DSText variant="body" weight="medium" numberOfLines={1}>
          {tx.description}
        </DSText>
        <DSText variant="caption" muted>
          {formatShortTime(tx.timestamp)}
        </DSText>
      </View>
      <DSSatsAmount
        amount={tx.amountSats}
        size="sm"
        color={isPositive ? "text-primary" : "text-muted-foreground"}
        showPlus={isPositive}
      />
    </View>
  );
}

interface TransactionListProps {
  transactions: WalletTransaction[];
}

export function TransactionList({ transactions }: TransactionListProps) {
  if (transactions.length === 0) {
    return (
      <DSCard className="mx-4">
        <DSText variant="body" muted className="text-center py-6">
          No transactions yet
        </DSText>
      </DSCard>
    );
  }

  return (
    <DSCard padded={false} className="mx-4">
      {transactions.map((tx, i) => (
        <React.Fragment key={tx.id}>
          {i > 0 && <DSDivider />}
          <TransactionRow tx={tx} />
        </React.Fragment>
      ))}
    </DSCard>
  );
}
