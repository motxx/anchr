import React, { useMemo } from "react";
import { View, Text, Platform, Pressable } from "react-native";
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
    <View className="flex-1 bg-background px-5 pt-16">
      <Text className="text-2xl font-black text-foreground tracking-tight mb-2">Map</Text>
      {userLocation && (
        <Text className="text-[11px] text-muted-foreground mb-4">
          Your location: {userLocation.lat.toFixed(4)}, {userLocation.lon.toFixed(4)}
        </Text>
      )}
      {queries.length === 0 ? (
        <View className="items-center py-20">
          <View className="w-16 h-16 rounded-full bg-surface items-center justify-center mb-4">
            <Ionicons name="location-outline" size={28} color="#52525b" />
          </View>
          <Text className="text-[15px] font-semibold text-foreground">No queries with GPS</Text>
          <Text className="text-[13px] text-muted-foreground mt-1">
            Queries with location data will appear here
          </Text>
        </View>
      ) : (
        queries.map((q) => (
          <Pressable
            key={q.id}
            className="bg-surface rounded-2xl p-4 mb-2 flex-row items-center gap-3 active:opacity-80"
            onPress={() => router.push(`/${q.id}`)}
          >
            <View className="w-10 h-10 rounded-full bg-emerald-950 items-center justify-center">
              <Ionicons name="location" size={18} color="#10b981" />
            </View>
            <View className="flex-1">
              <Text className="text-[15px] text-foreground font-semibold" numberOfLines={1}>{q.description}</Text>
              <Text className="text-[11px] text-muted-foreground mt-0.5">
                {q.expected_gps?.lat.toFixed(4)}, {q.expected_gps?.lon.toFixed(4)}
              </Text>
            </View>
            {q.bounty && (
              <View className="bg-emerald-950 rounded-full px-3 py-1.5">
                <Text className="text-[13px] font-bold text-primary">{q.bounty.amount_sats} sats</Text>
              </View>
            )}
          </Pressable>
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
      <View className="absolute top-16 left-5 bg-background/95 rounded-2xl px-4 py-2.5 border border-border flex-row items-center gap-2">
        <View className="w-6 h-6 rounded-full bg-emerald-950 items-center justify-center">
          <Ionicons name="location" size={12} color="#10b981" />
        </View>
        <Text className="text-[13px] font-semibold text-foreground">
          {queriesWithGps.length} {queriesWithGps.length === 1 ? "query" : "queries"} nearby
        </Text>
      </View>
    </View>
  );
}
