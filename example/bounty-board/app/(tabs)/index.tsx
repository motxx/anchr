import React from "react";
import { View, FlatList, RefreshControl, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DSText, DSEmptyState } from "../../src/components/ds";
import { FilterBar } from "../../src/components/bounty/FilterBar";
import { BountyCard } from "../../src/components/bounty/BountyCard";
import { useBountyFeed } from "../../src/hooks/useBountyFeed";
import { useNearbyNotifications } from "../../src/hooks/useNearbyNotifications";

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const { bounties, isLoading, refetch, userLocation } = useBountyFeed();

  useNearbyNotifications(bounties, userLocation);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="px-4 pt-4 pb-2">
        <DSText variant="heading" weight="bold">Bounties</DSText>
      </View>

      <FilterBar />

      {isLoading && bounties.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#10b981" />
        </View>
      ) : (
        <FlatList
          data={bounties}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <BountyCard
              bounty={item}
              userLocation={userLocation}
              onPress={() => router.push(`/bounty/${item.id}`)}
            />
          )}
          ListEmptyComponent={
            <DSEmptyState
              icon="flash-outline"
              title="No bounties yet"
              subtitle="Pull to refresh or check back later"
            />
          }
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={() => refetch()}
              tintColor="#10b981"
            />
          }
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      )}
    </View>
  );
}
