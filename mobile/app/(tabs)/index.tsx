import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { useQueries } from "../../src/hooks/useQueries";
import { QueryCard } from "../../src/components/QueryCard";
import {
  useNearbyNotifications,
  requestNotificationPermissions,
} from "../../src/hooks/useNearbyNotifications";
import { haversineKm } from "../../src/utils/distance";
import type { GpsCoord, QuerySummary } from "../../src/api/types";

export default function QueriesScreen() {
  const { data: queries, isLoading, isError, refetch, isFetching } = useQueries();
  const [userLocation, setUserLocation] = useState<GpsCoord | null>(null);
  const [isManualRefresh, setIsManualRefresh] = useState(false);

  useEffect(() => {
    (async () => {
      await requestNotificationPermissions();
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setUserLocation({ lat: loc.coords.latitude, lon: loc.coords.longitude });
    })();
  }, []);

  // Fire local notification when a query appears within 10km
  useNearbyNotifications(queries, userLocation);

  const onRefresh = useCallback(async () => {
    setIsManualRefresh(true);
    await refetch();
    setIsManualRefresh(false);
  }, [refetch]);

  // Sort queries: nearest first if location available
  const sortedQueries = React.useMemo(() => {
    if (!queries) return [];
    if (!userLocation) return queries;

    return [...queries].sort((a, b) => {
      const distA = a.expected_gps
        ? haversineKm(userLocation, a.expected_gps)
        : Infinity;
      const distB = b.expected_gps
        ? haversineKm(userLocation, b.expected_gps)
        : Infinity;
      return distA - distB;
    });
  }, [queries, userLocation]);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50">
        <ActivityIndicator size="large" color="#10b981" />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 px-6">
        <Ionicons name="cloud-offline-outline" size={48} color="#9ca3af" />
        <Text className="text-base font-medium text-gray-500 mt-3">
          Could not reach server
        </Text>
        <Text className="text-sm text-gray-400 mt-1">
          Check your server URL in Settings
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-stone-50">
      {/* Header */}
      <View className="px-4 pt-14 pb-3 bg-stone-50">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-xl font-bold text-gray-900 tracking-tight">
              Anchr
            </Text>
            <Text className="text-xs text-gray-400 mt-0.5">
              Ground truth from the street
            </Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            {isFetching ? (
              <ActivityIndicator size="small" color="#9ca3af" />
            ) : (
              <View className="w-2 h-2 rounded-full bg-emerald-400" />
            )}
            <Text className="text-xs text-gray-400">live</Text>
          </View>
        </View>
      </View>

      {/* List */}
      <FlatList
        data={sortedQueries}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <QueryCard query={item} userLocation={userLocation} />
        )}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        refreshControl={
          <RefreshControl refreshing={isManualRefresh} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View className="items-center justify-center py-20">
            <View className="w-14 h-14 rounded-full bg-gray-100 items-center justify-center mb-3">
              <Ionicons name="time-outline" size={24} color="#9ca3af" />
            </View>
            <Text className="text-sm font-medium text-gray-500">
              No pending queries
            </Text>
            <Text className="text-xs text-gray-400 mt-1">
              Pull to refresh
            </Text>
          </View>
        }
      />
    </View>
  );
}
