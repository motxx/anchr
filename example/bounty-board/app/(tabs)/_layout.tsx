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
        options={{ title: "Flights" }}
      />
      <Tabs.Screen
        name="wallet"
        options={{ title: "Wallet" }}
      />
    </Tabs>
  );
}
