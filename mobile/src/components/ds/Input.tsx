import React from "react";
import { View, Text, TextInput, type TextInputProps } from "react-native";

export interface DSInputProps extends TextInputProps {
  label?: string;
}

export function DSInput({ label, className = "", ...props }: DSInputProps) {
  return (
    <View>
      {label && (
        <Text className="text-sm font-medium text-muted-foreground mb-1.5">{label}</Text>
      )}
      <TextInput
        className={`bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-foreground ${className}`}
        placeholderTextColor="#52525b"
        {...props}
      />
    </View>
  );
}
