import React from "react";
import { Text as RNText, type TextProps } from "react-native";

type Variant = "heading" | "subheading" | "body" | "caption" | "label" | "mono";
type Weight = "normal" | "medium" | "semibold" | "bold" | "black";

const VARIANT_CLASSES: Record<Variant, string> = {
  heading: "text-xl tracking-tight",
  subheading: "text-lg",
  body: "text-sm",
  caption: "text-xs",
  label: "text-[10px] uppercase tracking-[0.15em]",
  mono: "font-mono text-sm",
};

const WEIGHT_CLASSES: Record<Weight, string> = {
  normal: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
  bold: "font-bold",
  black: "font-black",
};

export interface DSTextProps extends TextProps {
  variant?: Variant;
  weight?: Weight;
  muted?: boolean;
  color?: string;
}

export function DSText({
  variant = "body",
  weight = "normal",
  muted = false,
  color,
  className = "",
  ...props
}: DSTextProps) {
  const colorClass = color ?? (muted ? "text-muted-foreground" : "text-foreground");
  return (
    <RNText
      className={`${VARIANT_CLASSES[variant]} ${WEIGHT_CLASSES[weight]} ${colorClass} ${className}`}
      {...props}
    />
  );
}
