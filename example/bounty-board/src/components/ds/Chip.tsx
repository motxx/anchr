import React from "react";
import { Pressable, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export interface DSChipProps {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  selected?: boolean;
  onPress?: () => void;
}

export function DSChip({ label, icon, selected = false, onPress }: DSChipProps) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center gap-1.5 px-3 py-1.5 rounded-full border ${
        selected
          ? "bg-primary/20 border-primary"
          : "bg-surface border-border active:bg-surface-raised"
      }`}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={14}
          color={selected ? "#10b981" : "#a1a1aa"}
        />
      )}
      <Text
        className={`text-xs font-medium ${
          selected ? "text-primary" : "text-muted-foreground"
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
