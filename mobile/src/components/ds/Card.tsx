import React, { type ReactNode } from "react";
import { View, Pressable, type PressableProps, type ViewProps } from "react-native";

export interface DSCardProps extends ViewProps {
  children: ReactNode;
  padded?: boolean;
}

export function DSCard({ children, padded = true, className = "", ...props }: DSCardProps) {
  return (
    <View
      className={`bg-card rounded-xl border border-border ${padded ? "px-4 py-3.5" : ""} ${className}`}
      {...props}
    >
      {children}
    </View>
  );
}

export interface DSPressableCardProps extends Omit<PressableProps, "children"> {
  children: ReactNode;
  padded?: boolean;
}

export function DSPressableCard({ children, padded = true, className = "", ...props }: DSPressableCardProps) {
  return (
    <Pressable
      className={`bg-card rounded-xl border border-border overflow-hidden active:scale-[0.98] ${
        padded ? "px-4 py-3.5" : ""
      } ${className}`}
      style={{ elevation: 1 }}
      {...props}
    >
      {children}
    </Pressable>
  );
}
