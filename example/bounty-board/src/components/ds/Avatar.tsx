import React from "react";
import { View, Text, Image } from "react-native";

type AvatarSize = "sm" | "md" | "lg" | "xl";

const SIZE_MAP: Record<AvatarSize, { container: string; text: string; dim: number }> = {
  sm: { container: "w-8 h-8", text: "text-xs", dim: 32 },
  md: { container: "w-10 h-10", text: "text-sm", dim: 40 },
  lg: { container: "w-14 h-14", text: "text-lg", dim: 56 },
  xl: { container: "w-20 h-20", text: "text-2xl", dim: 80 },
};

const COLORS = [
  "bg-emerald-700", "bg-blue-700", "bg-purple-700", "bg-amber-700",
  "bg-rose-700", "bg-cyan-700", "bg-indigo-700", "bg-teal-700",
];

function getColorFromPubkey(pubkey: string): string {
  let hash = 0;
  for (let i = 0; i < pubkey.length; i++) {
    hash = (hash * 31 + pubkey.charCodeAt(i)) | 0;
  }
  return COLORS[Math.abs(hash) % COLORS.length]!;
}

function getInitials(pubkey: string): string {
  return pubkey.slice(0, 2).toUpperCase();
}

export interface DSAvatarProps {
  pubkey: string;
  imageUrl?: string;
  size?: AvatarSize;
}

export function DSAvatar({ pubkey, imageUrl, size = "md" }: DSAvatarProps) {
  const s = SIZE_MAP[size];

  if (imageUrl) {
    return (
      <Image
        source={{ uri: imageUrl }}
        className={`${s.container} rounded-full`}
        style={{ width: s.dim, height: s.dim }}
      />
    );
  }

  const bgColor = getColorFromPubkey(pubkey);
  return (
    <View className={`${s.container} ${bgColor} rounded-full items-center justify-center`}>
      <Text className={`${s.text} font-bold text-white`}>{getInitials(pubkey)}</Text>
    </View>
  );
}
