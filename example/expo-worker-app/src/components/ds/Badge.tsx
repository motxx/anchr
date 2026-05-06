import React from "react";
import { View, Text } from "react-native";

type BadgeVariant = "default" | "success" | "warning" | "error" | "info" | "muted";

const VARIANT_CLASSES: Record<BadgeVariant, { dot: string; text: string }> = {
  default: { dot: "bg-status-pending", text: "text-status-pending" },
  success: { dot: "bg-status-approved", text: "text-status-approved" },
  warning: { dot: "bg-warning", text: "text-warning" },
  error: { dot: "bg-status-rejected", text: "text-status-rejected" },
  info: { dot: "bg-info", text: "text-info" },
  muted: { dot: "bg-status-expired", text: "text-muted-foreground" },
};

export interface DSBadgeProps {
  label: string;
  variant?: BadgeVariant;
  /** Override dot color class. */
  dotColor?: string;
  /** Override text color class. */
  textColor?: string;
}

/** Linear-style status badge: colored dot + label. */
export function DSBadge({ label, variant = "default", dotColor, textColor }: DSBadgeProps) {
  const v = VARIANT_CLASSES[variant];
  return (
    <View className="flex-row items-center gap-1.5">
      <View className={`w-2 h-2 rounded-full ${dotColor ?? v.dot}`} />
      <Text className={`text-xs font-medium ${textColor ?? v.text}`}>{label}</Text>
    </View>
  );
}
