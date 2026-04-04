import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";

type SatsSize = "sm" | "md" | "lg" | "xl";

const SIZE_MAP: Record<SatsSize, { text: string; icon: number }> = {
  sm: { text: "text-xs", icon: 10 },
  md: { text: "text-sm", icon: 12 },
  lg: { text: "text-lg", icon: 16 },
  xl: { text: "text-3xl", icon: 24 },
};

export interface DSSatsAmountProps {
  amount: number;
  size?: SatsSize;
  color?: string;
  showPlus?: boolean;
}

export function DSSatsAmount({ amount, size = "md", color, showPlus = false }: DSSatsAmountProps) {
  const s = SIZE_MAP[size];
  const textColor = color ?? "text-primary";
  const prefix = showPlus && amount > 0 ? "+" : "";

  return (
    <View className="flex-row items-center gap-0.5">
      <Ionicons name="flash" size={s.icon} color="#10b981" />
      <Text className={`${s.text} font-bold ${textColor}`}>
        {prefix}{amount.toLocaleString()}
      </Text>
      {size !== "sm" && (
        <Text className={`text-xs font-medium ${textColor} opacity-70`}> sats</Text>
      )}
    </View>
  );
}
