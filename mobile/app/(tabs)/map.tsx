import React, { useMemo } from "react";
import { View, Text, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQueries } from "../../src/hooks/useQueries";
import { useUserLocation } from "../../src/hooks/useUserLocation";
import type { QuerySummary } from "../../src/api/types";

// MapView is only available on native — web falls back to a list
let MapView: any = null;
let Marker: any = null;
if (Platform.OS !== "web") {
  try {
    const maps = require("react-native-maps");
    MapView = maps.default;
    Marker = maps.Marker;
  } catch {
    // maps not linked
  }
}

function MapPin({ query, onPress }: { query: QuerySummary; onPress: () => void }) {
  if (!Marker || !query.expected_gps) return null;
  const isActive = !["approved", "rejected", "expired"].includes(query.status);
  return (
    <Marker
      coordinate={{ latitude: query.expected_gps.lat, longitude: query.expected_gps.lon }}
      title={query.description}
      description={`${query.bounty?.amount_sats ?? 0} sats`}
      pinColor={isActive ? "#10b981" : "#52525b"}
      onCalloutPress={onPress}
    />
  );
}

function WebFallback({ queries, userLocation }: { queries: QuerySummary[]; userLocation: { lat: number; lon: number } | null }) {
  const router = useRouter();
  return (
    <View className="flex-1 bg-background px-4 pt-14">
      <Text className="text-lg font-bold text-foreground mb-4">Nearby Queries</Text>
      {userLocation && (
        <Text className="text-xs text-muted-foreground mb-3">
          Your location: {userLocation.lat.toFixed(4)}, {userLocation.lon.toFixed(4)}
        </Text>
      )}
      {queries.length === 0 ? (
        <View className="items-center py-12">
          <Ionicons name="location-outline" size={32} color="#52525b" />
          <Text className="text-sm text-muted-foreground mt-2">No queries with GPS</Text>
        </View>
      ) : (
        queries.map((q) => (
          <View key={q.id} className="bg-surface rounded-lg p-3 mb-2 flex-row items-center gap-3 border border-border"
            onTouchEnd={() => router.push(`/${q.id}`)}
          >
            <Ionicons name="location" size={16} color="#10b981" />
            <View className="flex-1">
              <Text className="text-sm text-foreground" numberOfLines={1}>{q.description}</Text>
              <Text className="text-xs text-muted-foreground">
                {q.expected_gps?.lat.toFixed(4)}, {q.expected_gps?.lon.toFixed(4)}
              </Text>
            </View>
            {q.bounty && (
              <Text className="text-xs font-semibold text-amber-400">{q.bounty.amount_sats} sats</Text>
            )}
          </View>
        ))
      )}
    </View>
  );
}

export default function MapScreen() {
  const { data: queries } = useQueries();
  const userLocation = useUserLocation();
  const router = useRouter();

  const queriesWithGps = useMemo(
    () => (queries ?? []).filter((q) => q.expected_gps),
    [queries],
  );

  // Default region: user location or Tokyo
  const region = useMemo(() => {
    if (userLocation) {
      return {
        latitude: userLocation.lat,
        longitude: userLocation.lon,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
    }
    if (queriesWithGps.length > 0 && queriesWithGps[0]!.expected_gps) {
      return {
        latitude: queriesWithGps[0]!.expected_gps.lat,
        longitude: queriesWithGps[0]!.expected_gps.lon,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
    }
    return { latitude: 35.6812, longitude: 139.7671, latitudeDelta: 0.1, longitudeDelta: 0.1 };
  }, [userLocation, queriesWithGps]);

  if (!MapView) {
    return <WebFallback queries={queriesWithGps} userLocation={userLocation} />;
  }

  return (
    <View className="flex-1 bg-background">
      <MapView
        style={{ flex: 1 }}
        initialRegion={region}
        showsUserLocation
        showsMyLocationButton
      >
        {queriesWithGps.map((q) => (
          <MapPin
            key={q.id}
            query={q}
            onPress={() => router.push(`/${q.id}`)}
          />
        ))}
      </MapView>

      {/* Overlay: query count */}
      <View className="absolute top-14 left-4 bg-background/90 rounded-lg px-3 py-2 border border-border">
        <Text className="text-xs font-medium text-foreground">
          {queriesWithGps.length} {queriesWithGps.length === 1 ? "query" : "queries"} nearby
        </Text>
      </View>
    </View>
  );
}
