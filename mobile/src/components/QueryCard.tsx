import React, { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBadge } from "./StatusBadge";
import { getQueryType } from "./QueryTypeBadge";
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
  const queryType = getQueryType(query.verification_requirements);

  const typeIcon: keyof typeof Ionicons.glyphMap =
    queryType === "tlsn" ? "globe-outline" : queryType === "mixed" ? "layers-outline" : "camera-outline";
  const typeColor = queryType === "tlsn" ? "#60a5fa" : "#10b981";

  return (
    <Pressable
      onPress={() => router.push(`/${query.id}`)}
      className="bg-surface rounded-2xl overflow-hidden active:opacity-80"
    >
      <View className="px-4 py-4 flex-row items-center">
        {/* Left: Type icon */}
        <View
          className="w-12 h-12 rounded-full items-center justify-center mr-3.5"
          style={{ backgroundColor: queryType === "tlsn" ? "rgba(96,165,250,0.12)" : "rgba(16,185,129,0.12)" }}
        >
          <Ionicons name={typeIcon} size={22} color={typeColor} />
        </View>

        {/* Center: Content */}
        <View className="flex-1 mr-3">
          <View className="flex-row items-center gap-2 mb-1">
            <Text className="text-[15px] text-foreground font-semibold flex-1" numberOfLines={1}>
              {query.description}
            </Text>
          </View>

          <View className="flex-row items-center gap-2">
            <StatusBadge status={query.status} />

            {/* Timer */}
            <View className="flex-row items-center gap-1">
              <Ionicons
                name="time-outline"
                size={10}
                color={critical ? "#ef4444" : urgent ? "#f59e0b" : "#52525b"}
              />
              <Text
                className={`text-[11px] ${
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

            {/* TLSNotary domain */}
            {isTlsn && query.tlsn_requirements?.target_url && (
              <View className="flex-row items-center gap-1">
                <Ionicons name="lock-closed" size={9} color="#60a5fa" />
                <Text className="text-[11px] text-blue-400" numberOfLines={1}>
                  {extractDomain(query.tlsn_requirements.target_url)}
                </Text>
              </View>
            )}
          </View>

          {/* Location + Distance */}
          {(query.location_hint || distance !== null) && (
            <View className="flex-row items-center gap-2 mt-1">
              {query.location_hint && (
                <View className="flex-row items-center gap-1">
                  <Ionicons name="location-outline" size={10} color="#52525b" />
                  <Text className="text-[11px] text-muted-foreground" numberOfLines={1}>
                    {query.location_hint}
                  </Text>
                </View>
              )}
              {distance !== null && (
                <View className="flex-row items-center gap-1">
                  <Ionicons name="navigate-outline" size={10} color="#52525b" />
                  <Text className="text-[11px] text-muted-foreground">
                    {formatDistance(distance)}
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Right: Bounty amount */}
        <View className="items-end">
          {query.bounty && query.bounty.amount_sats > 0 ? (
            <View className="bg-emerald-950 rounded-full px-3 py-1.5">
              <Text className="text-[13px] font-bold text-primary">
                {query.bounty.amount_sats} sats
              </Text>
            </View>
          ) : (
            <Ionicons name="chevron-forward" size={18} color="#3f3f46" />
          )}
        </View>
      </View>
    </Pressable>
  );
}
