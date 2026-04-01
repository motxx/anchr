import React from "react";
import { View } from "react-native";

export interface DSProgressBarProps {
  progress: number; // 0-1
  color?: string;
  className?: string;
}

export function DSProgressBar({ progress, color = "bg-primary", className = "" }: DSProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <View className={`h-1 bg-surface-raised rounded-full overflow-hidden ${className}`}>
      <View
        className={`h-full ${color} rounded-full`}
        style={{ width: `${clamped * 100}%` }}
      />
    </View>
  );
}
