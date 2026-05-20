import React, { type ReactNode } from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { DSText } from "./Text";

type FeedbackVariant = "success" | "error" | "warning" | "info";

const VARIANT_CONFIG: Record<FeedbackVariant, {
  bg: string; border: string; icon: keyof typeof Ionicons.glyphMap; iconColor: string; textColor: string;
}> = {
  success: { bg: "bg-emerald-950/50", border: "border-emerald-800", icon: "checkmark-circle", iconColor: "#10b981", textColor: "text-emerald-400" },
  error: { bg: "bg-red-950/50", border: "border-red-800", icon: "alert-circle", iconColor: "#ef4444", textColor: "text-red-400" },
  warning: { bg: "bg-amber-950/50", border: "border-amber-800", icon: "warning", iconColor: "#f59e0b", textColor: "text-amber-400" },
  info: { bg: "bg-blue-950/50", border: "border-blue-800", icon: "information-circle", iconColor: "#3b82f6", textColor: "text-blue-400" },
};

export interface DSFeedbackBannerProps {
  variant: FeedbackVariant;
  message: string;
  children?: ReactNode;
}

export function DSFeedbackBanner({ variant, message, children }: DSFeedbackBannerProps) {
  const v = VARIANT_CONFIG[variant];
  return (
    <View className={`${v.bg} border ${v.border} rounded-xl p-4 flex-row items-start gap-3`}>
      <Ionicons name={v.icon} size={18} color={v.iconColor} />
      <View className="flex-1">
        <DSText variant="body" weight="medium" color={v.textColor}>{message}</DSText>
        {children}
      </View>
    </View>
  );
}
