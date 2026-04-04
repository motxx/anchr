import React from "react";
import { Pressable, Text, ActivityIndicator, type PressableProps } from "react-native";
import { Ionicons } from "@expo/vector-icons";

type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<Variant, { container: string; text: string; active: string }> = {
  primary: {
    container: "bg-primary",
    text: "text-primary-foreground font-semibold",
    active: "active:bg-primary-hover",
  },
  secondary: {
    container: "bg-surface-raised border border-border",
    text: "text-foreground font-semibold",
    active: "active:bg-muted",
  },
  ghost: {
    container: "bg-transparent",
    text: "text-muted-foreground font-medium",
    active: "active:bg-surface-raised",
  },
  destructive: {
    container: "bg-destructive",
    text: "text-white font-semibold",
    active: "active:opacity-90",
  },
};

const SIZE_CLASSES: Record<Size, { container: string; text: string; icon: number }> = {
  sm: { container: "py-2 px-3 rounded-lg", text: "text-xs", icon: 14 },
  md: { container: "py-3 px-4 rounded-xl", text: "text-sm", icon: 16 },
  lg: { container: "py-4 px-5 rounded-xl", text: "text-base", icon: 20 },
};

export interface DSButtonProps extends Omit<PressableProps, "children"> {
  variant?: Variant;
  size?: Size;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  fullWidth?: boolean;
}

export function DSButton({
  variant = "primary",
  size = "md",
  label,
  icon,
  loading = false,
  fullWidth = false,
  disabled,
  className = "",
  ...props
}: DSButtonProps) {
  const v = VARIANT_CLASSES[variant];
  const s = SIZE_CLASSES[size];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      disabled={isDisabled}
      className={`${v.container} ${s.container} ${v.active} flex-row items-center justify-center gap-2 ${
        isDisabled ? "opacity-40" : ""
      } ${fullWidth ? "w-full" : ""} ${className}`}
      {...props}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variant === "primary" ? "#fff" : "#a1a1aa"} />
      ) : icon ? (
        <Ionicons name={icon} size={s.icon} color={variant === "primary" ? "#fff" : "#a1a1aa"} />
      ) : null}
      <Text className={`${v.text} ${s.text}`}>{label}</Text>
    </Pressable>
  );
}
