import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

type IconSize = "xs" | "sm" | "md" | "lg";

const SIZE_MAP: Record<IconSize, { icon: number; container: string }> = {
  xs: { icon: 12, container: "" },
  sm: { icon: 14, container: "" },
  md: { icon: 20, container: "" },
  lg: { icon: 32, container: "" },
};

export interface DSIconProps {
  name: keyof typeof Ionicons.glyphMap;
  size?: IconSize;
  color?: string;
  circle?: boolean;
  circleBg?: string;
}

export function DSIcon({ name, size = "sm", color = "#6b7280", circle, circleBg = "bg-gray-100" }: DSIconProps) {
  const s = SIZE_MAP[size];
  const icon = <Ionicons name={name} size={s.icon} color={color} />;

  if (circle) {
    const dim = s.icon * 2.2;
    return (
      <View
        className={`${circleBg} rounded-full items-center justify-center`}
        style={{ width: dim, height: dim }}
      >
        {icon}
      </View>
    );
  }

  return icon;
}
