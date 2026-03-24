import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQueries } from "../../src/hooks/useQueries";
import { useUserLocation } from "../../src/hooks/useUserLocation";

export default function MapScreen() {
  const { data: queries } = useQueries();
  const userLocation = useUserLocation();

  const queriesWithGps = queries?.filter((q) => q.expected_gps) ?? [];

  // Phase 2: Replace with react-native-maps MapView
  return (
    <View className="flex-1 bg-background items-center justify-center px-6">
      <View className="items-center gap-3">
        <View className="w-16 h-16 rounded-full bg-emerald-950 items-center justify-center">
          <Ionicons name="map-outline" size={32} color="#10b981" />
        </View>
        <Text className="text-lg font-semibold text-foreground">Map View</Text>
        <Text className="text-sm text-muted-foreground text-center">
          {queriesWithGps.length > 0
            ? `${queriesWithGps.length} queries with GPS coordinates`
            : "No queries with GPS coordinates yet"}
        </Text>
        {userLocation && (
          <Text className="text-xs text-muted-foreground">
            Your location: {userLocation.lat.toFixed(4)}, {userLocation.lon.toFixed(4)}
          </Text>
        )}
        <Text className="text-xs text-muted-foreground mt-2">
          Full map coming in Phase 2
        </Text>
      </View>
    </View>
  );
}
