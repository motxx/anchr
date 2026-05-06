import React, { type ReactNode } from "react";
import { View } from "react-native";
import { DSText } from "./Text";

export interface DSSectionProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

export function DSSection({ title, children, className = "" }: DSSectionProps) {
  return (
    <View className={className}>
      {title && (
        <DSText variant="label" weight="semibold" muted className="mb-2">
          {title}
        </DSText>
      )}
      {children}
    </View>
  );
}
