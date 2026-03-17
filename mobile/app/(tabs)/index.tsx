import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { notificationProvider } from "../../src/platform/notifications";
import { useQueries } from "../../src/hooks/useQueries";
import { useUserLocation } from "../../src/hooks/useUserLocation";
import { QueryCard } from "../../src/components/QueryCard";
import { useNearbyNotifications } from "../../src/hooks/useNearbyNotifications";
import { haversineKm } from "../../src/utils/distance";
import { formatShortTime } from "../../src/utils/time";
import type { QuerySummary } from "../../src/api/types";
import { useWalletStore, type WalletTransaction } from "../../src/store/wallet";

// Request notification permission once at module level
notificationProvider.requestPermission().catch(() => {});

const HistoryRow = React.memo(function HistoryRow({ tx }: { tx: WalletTransaction }) {
  return (
    <View className="bg-white rounded-xl px-4 py-3 flex-row items-center">
      <View className="w-8 h-8 rounded-full bg-emerald-50 items-center justify-center mr-3">
        <Ionicons name="checkmark" size={16} color="#10b981" />
      </View>
      <View className="flex-1 mr-3">
        <Text className="text-sm text-gray-900" numberOfLines={1}>
          {tx.description}
        </Text>
        <View className="flex-row items-center gap-2 mt-0.5">
          {tx.locationHint ? (
            <Text className="text-xs text-gray-400">{tx.locationHint}</Text>
          ) : null}
          <Text className="text-xs text-gray-300">
            {formatShortTime(tx.timestamp)}
          </Text>
        </View>
      </View>
      <Text className="text-sm font-semibold text-emerald-600">
        +{tx.amountSats} sats
      </Text>
    </View>
  );
});

export default function QueriesScreen() {
  const { data: queries, isLoading, isError, refetch, isFetching } = useQueries();
  const userLocation = useUserLocation();
  const transactions = useWalletStore((s) => s.transactions);

  // Fire local notification when a query appears within 10km
  useNearbyNotifications(queries, userLocation);

  const onRefresh = useCallback(async () => {
    await refetch();
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

      {/* List with history */}
      <FlatList
        data={sortedQueries}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <QueryCard query={item} userLocation={userLocation} />
        )}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }}
        refreshControl={
          <RefreshControl refreshing={isFetching} onRefresh={onRefresh} />
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
        ListFooterComponent={
          transactions.length > 0 ? (
            <View className="mt-4">
              <Text className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
                Completed
              </Text>
              <View style={{ gap: 8 }}>
                {transactions.map((tx) => (
                  <HistoryRow key={tx.id} tx={tx} />
                ))}
              </View>
            </View>
          ) : null
        }
      />
    </View>
  );
}
