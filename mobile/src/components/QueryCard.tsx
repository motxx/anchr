import React, { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBadge } from "./StatusBadge";
import { QueryTypeBadge } from "./QueryTypeBadge";
import { timeLeft, isExpired, isUrgent, isCritical } from "../utils/time";
import { haversineKm, formatDistance } from "../utils/distance";
import type { QuerySummary, GpsCoord } from "../api/types";

interface Props {
  query: QuerySummary;
  userLocation?: GpsCoord | null;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function QueryCard({ query, userLocation }: Props) {
  const router = useRouter();
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const expired = isExpired(query.expires_at);
  const urgent = isUrgent(query.expires_at);
  const critical = isCritical(query.expires_at);

  const distance =
    userLocation && query.expected_gps
      ? haversineKm(userLocation, query.expected_gps)
      : null;

  const isTlsn = query.verification_requirements.includes("tlsn");

  return (
    <Pressable
      onPress={() => router.push(`/${query.id}`)}
      className="bg-surface rounded-xl border border-border overflow-hidden active:bg-surface-raised"
    >
      <View className="px-4 py-3.5">
        {/* Top row: type badge + status + timer */}
        <View className="flex-row items-center justify-between mb-2">
          <View className="flex-row items-center gap-2">
            <QueryTypeBadge requirements={query.verification_requirements} />
            <StatusBadge status={query.status} />
          </View>
          <View className="flex-row items-center gap-1">
            <Ionicons
              name="time-outline"
              size={11}
              color={critical ? "#ef4444" : urgent ? "#f59e0b" : "#52525b"}
            />
            <Text
              className={`text-xs font-medium ${
                critical
                  ? "text-red-400"
                  : urgent
                    ? "text-amber-400"
                    : "text-subtle"
              }`}
            >
              {timeLeft(query.expires_at)}
            </Text>
          </View>
        </View>

        {/* Description */}
        <Text className="text-sm text-foreground font-medium mb-1.5" numberOfLines={2}>
          {query.description}
        </Text>

        {/* TLSNotary target domain */}
        {isTlsn && query.tlsn_requirements?.target_url && (
          <View className="flex-row items-center gap-1.5 mb-1.5">
            <Ionicons name="lock-closed" size={10} color="#60a5fa" />
            <Text className="text-xs text-blue-400" numberOfLines={1}>
              {extractDomain(query.tlsn_requirements.target_url)}
            </Text>
          </View>
        )}

        {/* Bottom row: location + bounty + distance */}
        <View className="flex-row items-center justify-between mt-0.5">
          <View className="flex-row items-center gap-3">
            {query.location_hint && (
              <View className="flex-row items-center gap-1">
                <Ionicons name="location-outline" size={11} color="#52525b" />
                <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                  {query.location_hint}
                </Text>
              </View>
            )}
            {distance !== null && (
              <View className="flex-row items-center gap-1">
                <Ionicons name="navigate-outline" size={11} color="#52525b" />
                <Text className="text-xs text-muted-foreground">
                  {formatDistance(distance)}
                </Text>
              </View>
            )}
          </View>

          <View className="flex-row items-center gap-2">
            {query.bounty && query.bounty.amount_sats > 0 && (
              <View className="flex-row items-center gap-1">
                <Ionicons name="flash" size={11} color="#f59e0b" />
                <Text className="text-xs font-semibold text-amber-400">
                  {query.bounty.amount_sats} sats
                </Text>
              </View>
            )}
            <Ionicons name="chevron-forward" size={14} color="#3f3f46" />
          </View>
        </View>
      </View>
    </Pressable>
  );
}
