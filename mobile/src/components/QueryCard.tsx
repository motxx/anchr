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

  // Update countdown every second
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
      onPress={() => router.push(`/query/${query.id}`)}
      className="bg-white rounded-xl border border-gray-200 overflow-hidden active:scale-[0.98]"
      style={{ elevation: 1 }}
    >
      <View className="px-4 py-3.5">
        {/* Top row: status + timer */}
        <View className="flex-row items-center justify-between mb-2">
          <StatusBadge status={query.status} />
          <View className="flex-row items-center gap-1">
            <Ionicons
              name="time-outline"
              size={12}
              color={critical ? "#ef4444" : urgent ? "#f59e0b" : "#9ca3af"}
            />
            <Text
              className={`text-xs font-medium ${
                critical
                  ? "text-red-500"
                  : urgent
                    ? "text-amber-500"
                    : "text-gray-400"
              }`}
            >
              {timeLeft(query.expires_at)}
            </Text>
          </View>
        </View>

        {/* Description */}
        <Text className="text-sm text-gray-900 font-medium mb-2" numberOfLines={2}>
          {query.description}
        </Text>

        {/* Bottom row: location + bounty + distance */}
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-3">
            {query.location_hint && (
              <View className="flex-row items-center gap-1">
                <Ionicons name="location-outline" size={12} color="#6b7280" />
                <Text className="text-xs text-gray-500" numberOfLines={1}>
                  {query.location_hint}
                </Text>
              </View>
            )}
            {distance !== null && (
              <View className="flex-row items-center gap-1">
                <Ionicons name="navigate-outline" size={12} color="#6b7280" />
                <Text className="text-xs text-gray-500">
                  {formatDistance(distance)}
                </Text>
              </View>
            )}
          </View>

          <View className="flex-row items-center gap-2">
            {query.bounty && query.bounty.amount_sats > 0 && (
              <View className="flex-row items-center gap-1">
                <Ionicons name="flash" size={12} color="#f59e0b" />
                <Text className="text-xs font-semibold text-amber-500">
                  {query.bounty.amount_sats} sats
                </Text>
              </View>
            )}
            <Ionicons name="chevron-forward" size={16} color="#d1d5db" />
          </View>
        </View>
      </View>
    </Pressable>
  );
}
