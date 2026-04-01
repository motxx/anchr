import React from "react";
import { View } from "react-native";
import { DSPressableCard, DSText, DSBadge, DSSatsAmount } from "../ds";
import { timeLeft, isUrgent, isExpired } from "../../utils/time";
import { formatDistance, haversineKm } from "../../utils/distance";
import type { QuerySummary, GpsCoord } from "../../api/types";
import { Ionicons } from "@expo/vector-icons";

interface BountyCardProps {
  bounty: QuerySummary;
  userLocation?: GpsCoord | null;
  onPress: () => void;
}

function getStatusVariant(status: string) {
  switch (status) {
    case "pending":
    case "awaiting_quotes":
      return "default" as const;
    case "worker_selected":
    case "processing":
    case "verifying":
      return "warning" as const;
    case "approved":
      return "success" as const;
    case "rejected":
      return "error" as const;
    case "expired":
      return "muted" as const;
    default:
      return "default" as const;
  }
}

export function BountyCard({ bounty, userLocation, onPress }: BountyCardProps) {
  const isPhoto = !bounty.tlsn_requirements;
  const expired = isExpired(bounty.expires_at);
  const urgent = !expired && isUrgent(bounty.expires_at);

  return (
    <DSPressableCard onPress={onPress} className="mx-4 mb-2">
      <View className="flex-row items-start gap-3">
        {/* Type icon */}
        <View className="w-9 h-9 rounded-full bg-surface-raised items-center justify-center mt-0.5">
          <Ionicons
            name={isPhoto ? "camera" : "globe"}
            size={18}
            color={isPhoto ? "#10b981" : "#3b82f6"}
          />
        </View>

        {/* Content */}
        <View className="flex-1">
          <DSText variant="body" weight="medium" numberOfLines={2}>
            {bounty.description}
          </DSText>

          <View className="flex-row items-center gap-3 mt-1.5">
            <DSBadge
              label={bounty.status.replace(/_/g, " ")}
              variant={getStatusVariant(bounty.status)}
            />

            {!expired && (
              <DSText
                variant="caption"
                color={urgent ? "text-warning" : "text-muted-foreground"}
              >
                {timeLeft(bounty.expires_at)}
              </DSText>
            )}

            {bounty.location_hint && (
              <View className="flex-row items-center gap-0.5">
                <Ionicons name="location-outline" size={11} color="#a1a1aa" />
                <DSText variant="caption" muted numberOfLines={1}>
                  {bounty.location_hint}
                </DSText>
              </View>
            )}

            {userLocation && bounty.expected_gps && (
              <DSText variant="caption" muted>
                {formatDistance(haversineKm(userLocation, bounty.expected_gps))}
              </DSText>
            )}
          </View>
        </View>

        {/* Sats */}
        {bounty.bounty && (
          <DSSatsAmount amount={bounty.bounty.amount_sats} size="sm" />
        )}
      </View>
    </DSPressableCard>
  );
}
