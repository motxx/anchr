import React from "react";
import { View, Text } from "react-native";

type BadgeVariant = "default" | "success" | "warning" | "error" | "info" | "muted";

const VARIANT_CLASSES: Record<BadgeVariant, { bg: string; text: string }> = {
  default: { bg: "bg-blue-50", text: "text-blue-700" },
  success: { bg: "bg-emerald-50", text: "text-emerald-700" },
  warning: { bg: "bg-amber-50", text: "text-amber-700" },
  error: { bg: "bg-red-50", text: "text-red-700" },
  info: { bg: "bg-cyan-50", text: "text-cyan-700" },
  muted: { bg: "bg-gray-100", text: "text-gray-500" },
};

export interface DSBadgeProps {
  label: string;
  variant?: BadgeVariant;
  /** Override bg class directly (e.g., "bg-purple-50"). */
  bg?: string;
  /** Override text color class directly (e.g., "text-purple-700"). */
  textColor?: string;
}

export function DSBadge({ label, variant = "default", bg, textColor }: DSBadgeProps) {
  const v = VARIANT_CLASSES[variant];
  return (
    <View className={`${bg ?? v.bg} rounded-full px-2.5 py-0.5`}>
      <Text className={`${textColor ?? v.text} text-xs font-semibold`}>{label}</Text>
    </View>
  );
}
