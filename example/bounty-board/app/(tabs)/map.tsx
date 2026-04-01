import React from "react";
import { View, Platform } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DSText, DSEmptyState, DSPressableCard, DSSatsAmount } from "../../src/components/ds";
import { useBountyFeed } from "../../src/hooks/useBountyFeed";
import { FlatList } from "react-native";

let MapView: any = null;
let Marker: any = null;
let Callout: any = null;

try {
  if (Platform.OS !== "web") {
    const Maps = require("react-native-maps");
    MapView = Maps.default;
    Marker = Maps.Marker;
    Callout = Maps.Callout;
  }
} catch {
  // Maps not available
}

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { bounties, userLocation } = useBountyFeed();

  const geoItems = bounties.filter((b) => b.expected_gps);

  // Web fallback: list view
  if (!MapView) {
    return (
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <View className="px-4 pt-4 pb-2">
          <DSText variant="heading" weight="bold">Map</DSText>
          <DSText variant="caption" muted>Map view is available on iOS/Android</DSText>
        </View>
        <FlatList
          data={geoItems}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <DSPressableCard
              className="mx-4 mb-2"
              onPress={() => router.push(`/bounty/${item.id}`)}
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-1">
                  <DSText variant="body" weight="medium" numberOfLines={1}>
                    {item.description}
                  </DSText>
                  <DSText variant="caption" muted>
                    {item.location_hint ?? `${item.expected_gps!.lat.toFixed(3)}, ${item.expected_gps!.lon.toFixed(3)}`}
                  </DSText>
                </View>
                {item.bounty && <DSSatsAmount amount={item.bounty.amount_sats} size="sm" />}
              </View>
            </DSPressableCard>
          )}
          ListEmptyComponent={
            <DSEmptyState icon="map-outline" title="No bounties with location" />
          }
          contentContainerStyle={{ paddingBottom: 20, paddingTop: 8 }}
        />
      </View>
    );
  }

  // Native: MapView
  const initialRegion = userLocation
    ? { latitude: userLocation.lat, longitude: userLocation.lon, latitudeDelta: 0.1, longitudeDelta: 0.1 }
    : { latitude: 35.68, longitude: 139.76, latitudeDelta: 5, longitudeDelta: 5 };

  return (
    <View className="flex-1 bg-background">
      <MapView
        style={{ flex: 1 }}
        initialRegion={initialRegion}
        showsUserLocation
      >
        {geoItems.map((item) => (
          <Marker
            key={item.id}
            coordinate={{ latitude: item.expected_gps!.lat, longitude: item.expected_gps!.lon }}
            pinColor="#10b981"
          >
            <Callout onPress={() => router.push(`/bounty/${item.id}`)}>
              <View style={{ padding: 8, maxWidth: 200 }}>
                <DSText variant="body" weight="medium" numberOfLines={2} color="text-black">
                  {item.description}
                </DSText>
                {item.bounty && (
                  <DSText variant="caption" color="text-emerald-600">
                    {item.bounty.amount_sats} sats
                  </DSText>
                )}
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>
    </View>
  );
}
