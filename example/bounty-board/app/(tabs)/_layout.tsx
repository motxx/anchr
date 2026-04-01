import React from "react";
import { Tabs } from "expo-router";
import { DSTabBar } from "../../src/components/ds";

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <DSTabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Feed" }}
      />
      <Tabs.Screen
        name="map"
        options={{ title: "Map" }}
      />
      <Tabs.Screen
        name="create"
        options={{ title: "Create" }}
      />
      <Tabs.Screen
        name="wallet"
        options={{ title: "Wallet" }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: "Profile" }}
      />
    </Tabs>
  );
}
