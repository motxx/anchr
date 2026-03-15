import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { useQueries } from "../../src/hooks/useQueries";
import type { GpsCoord } from "../../src/api/types";

export default function MapScreen() {
  const { data: queries } = useQueries();
  const [userLocation, setUserLocation] = useState<GpsCoord | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setUserLocation({ lat: loc.coords.latitude, lon: loc.coords.longitude });
    })();
  }, []);

  const queriesWithGps = queries?.filter((q) => q.expected_gps) ?? [];

  // Phase 2: Replace with react-native-maps MapView
  return (
    <View className="flex-1 bg-stone-50 items-center justify-center px-6">
      <View className="items-center gap-3">
        <View className="w-16 h-16 rounded-full bg-emerald-50 items-center justify-center">
          <Ionicons name="map-outline" size={32} color="#10b981" />
        </View>
        <Text className="text-lg font-semibold text-gray-900">Map View</Text>
        <Text className="text-sm text-gray-500 text-center">
          {queriesWithGps.length > 0
            ? `${queriesWithGps.length} queries with GPS coordinates`
            : "No queries with GPS coordinates yet"}
        </Text>
        {userLocation && (
          <Text className="text-xs text-gray-400">
            Your location: {userLocation.lat.toFixed(4)}, {userLocation.lon.toFixed(4)}
          </Text>
        )}
        <Text className="text-xs text-gray-400 mt-2">
          Full map coming in Phase 2
        </Text>
      </View>
    </View>
  );
}
