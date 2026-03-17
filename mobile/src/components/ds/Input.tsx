import React from "react";
import { View, Text, TextInput, type TextInputProps } from "react-native";

export interface DSInputProps extends TextInputProps {
  label?: string;
}

export function DSInput({ label, className = "", ...props }: DSInputProps) {
  return (
    <View>
      {label && (
        <Text className="text-sm font-medium text-foreground mb-1">{label}</Text>
      )}
      <TextInput
        className={`bg-muted/40 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground ${className}`}
        placeholderTextColor="#a8a29e"
        {...props}
      />
    </View>
  );
}
