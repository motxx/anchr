import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { VerificationFactor } from "../api/types";

type QueryType = "photo" | "tlsn" | "mixed";

export function getQueryType(requirements: VerificationFactor[]): QueryType {
  const hasTlsn = requirements.includes("tlsn");
  const hasPhoto = requirements.some((r) => r === "nonce" || r === "gps");
  if (hasTlsn && !hasPhoto) return "tlsn";
  if (!hasTlsn && hasPhoto) return "photo";
  if (hasTlsn && hasPhoto) return "mixed";
  // Default to photo for queries without specific requirements
  return "photo";
}

const TYPE_CONFIG: Record<QueryType, { icon: keyof typeof Ionicons.glyphMap; label: string; color: string; bg: string }> = {
  photo: { icon: "camera-outline", label: "Photo", color: "#a78bfa", bg: "bg-violet-900/30" },
  tlsn: { icon: "globe-outline", label: "Web Proof", color: "#60a5fa", bg: "bg-blue-900/30" },
  mixed: { icon: "layers-outline", label: "Combined", color: "#f59e0b", bg: "bg-amber-900/30" },
};

export function QueryTypeBadge({ requirements }: { requirements: VerificationFactor[] }) {
  const type = getQueryType(requirements);
  const config = TYPE_CONFIG[type];

  return (
    <View className={`flex-row items-center gap-1 rounded-md px-1.5 py-0.5 ${config.bg}`}>
      <Ionicons name={config.icon} size={10} color={config.color} />
      <Text style={{ color: config.color, fontSize: 10, fontWeight: "600" }}>
        {config.label}
      </Text>
    </View>
  );
}
