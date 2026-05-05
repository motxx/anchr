import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { DSText } from "./Text";

export interface DSEmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
}

export function DSEmptyState({ icon, title, subtitle }: DSEmptyStateProps) {
  return (
    <View className="items-center justify-center py-20">
      <View className="w-12 h-12 rounded-full bg-surface-raised items-center justify-center mb-3">
        <Ionicons name={icon} size={20} color="#52525b" />
      </View>
      <DSText variant="body" weight="medium" muted>{title}</DSText>
      {subtitle && (
        <DSText variant="caption" muted className="mt-1 text-center">{subtitle}</DSText>
      )}
    </View>
  );
}
