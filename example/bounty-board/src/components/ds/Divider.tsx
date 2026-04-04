import React from "react";
import { View } from "react-native";

export interface DSDividerProps {
  className?: string;
}

export function DSDivider({ className = "" }: DSDividerProps) {
  return <View className={`h-px bg-border ${className}`} />;
}
