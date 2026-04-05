import React from "react";
import { View } from "react-native";
import { DSPressableCard, DSText, DSSatsAmount } from "../ds";
import { timeLeft } from "../../utils/time";
import type { FlightClaim } from "../../hooks/useAutoClaims";
import { Ionicons } from "@expo/vector-icons";

interface FlightCardProps {
  claim: FlightClaim;
  onPress: () => void;
}

const STATUS_CONFIG = {
  monitoring: { label: "監視中", color: "#3b82f6", icon: "radio-outline" as const },
  verifying: { label: "検証中", color: "#f59e0b", icon: "hourglass-outline" as const },
  claimed: { label: "補償済み", color: "#10b981", icon: "checkmark-circle" as const },
  rejected: { label: "却下", color: "#ef4444", icon: "close-circle" as const },
  expired: { label: "期限切れ", color: "#71717a", icon: "time-outline" as const },
} as const;

export function FlightCard({ claim, onPress }: FlightCardProps) {
  const config = STATUS_CONFIG[claim.status];
  const isClaimed = claim.status === "claimed";

  return (
    <DSPressableCard onPress={onPress} className="mx-4 mb-2.5">
      <View className="flex-row items-center gap-3">
        {/* Flight icon */}
        <View
          className="w-11 h-11 rounded-xl items-center justify-center"
          style={{ backgroundColor: config.color + "18" }}
        >
          <Ionicons name="airplane" size={22} color={config.color} />
        </View>

        {/* Flight info */}
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <DSText variant="body" weight="bold">
              {claim.flightNumber}
            </DSText>
            <DSText variant="caption" muted>
              {claim.origin} → {claim.destination}
            </DSText>
          </View>

          <View className="flex-row items-center gap-2 mt-1">
            {/* Status dot + label */}
            <View className="flex-row items-center gap-1">
              <Ionicons name={config.icon} size={12} color={config.color} />
              <DSText variant="caption" color={`text-[${config.color}]`} style={{ color: config.color }}>
                {config.label}
              </DSText>
            </View>

            {/* Time info */}
            {claim.status === "monitoring" && (
              <DSText variant="caption" muted>
                {claim.scheduledDeparture}発 · 残り {timeLeft(claim.expiresAt)}
              </DSText>
            )}
          </View>
        </View>

        {/* Payout */}
        <View className="items-end">
          {isClaimed ? (
            <View className="items-end">
              <DSSatsAmount amount={claim.payoutSats} size="sm" showPlus />
              <DSText variant="caption" style={{ color: "#10b981", fontSize: 10 }}>
                回収済み
              </DSText>
            </View>
          ) : (
            <View className="items-end">
              <DSSatsAmount amount={claim.payoutSats} size="sm" />
              <DSText variant="caption" muted style={{ fontSize: 10 }}>
                遅延時
              </DSText>
            </View>
          )}
        </View>
      </View>
    </DSPressableCard>
  );
}

// Re-export for backward compat
export { FlightCard as ClaimCard };
