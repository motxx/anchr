import React from "react";
import { View } from "react-native";
import { DSCard, DSText, DSSatsAmount } from "../ds";

interface BalanceCardProps {
  balance: number;
}

export function BalanceCard({ balance }: BalanceCardProps) {
  return (
    <DSCard className="mx-4 items-center py-8">
      <DSText variant="caption" muted className="mb-2">
        WALLET BALANCE
      </DSText>
      <DSSatsAmount amount={balance} size="xl" />
    </DSCard>
  );
}
