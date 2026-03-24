import React, { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBadge } from "./StatusBadge";
import { timeLeft, isExpired, isUrgent, isCritical } from "../utils/time";
import { haversineKm, formatDistance } from "../utils/distance";
import type { QuerySummary, GpsCoord } from "../api/types";

interface Props {
  query: QuerySummary;
  userLocation?: GpsCoord | null;
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

  return (
    <Pressable
      onPress={() => router.push(`/${query.id}`)}
      className="bg-surface rounded-xl border border-border overflow-hidden active:bg-surface-raised"
    >
      <View className="px-4 py-3.5">
        {/* Top row: status + timer */}
        <View className="flex-row items-center justify-between mb-2">
          <StatusBadge status={query.status} />
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
        <Text className="text-sm text-foreground font-medium mb-2" numberOfLines={2}>
          {query.description}
        </Text>

        {/* Bottom row: location + bounty + distance */}
        <View className="flex-row items-center justify-between">
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
