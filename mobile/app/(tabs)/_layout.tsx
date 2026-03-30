import React from "react";
import { View } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#10b981",
        tabBarInactiveTintColor: "#52525b",
        tabBarStyle: {
          backgroundColor: "#09090b",
          borderTopColor: "#18181b",
          height: 88,
          paddingBottom: 28,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
          letterSpacing: 0.3,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Queries",
          tabBarIcon: ({ color, focused }) => (
            <View
              className={`items-center justify-center rounded-full ${focused ? "bg-emerald-950" : ""}`}
              style={{ width: 36, height: 36 }}
            >
              <Ionicons name={focused ? "search" : "search-outline"} size={22} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: "Map",
          tabBarIcon: ({ color, focused }) => (
            <View
              className={`items-center justify-center rounded-full ${focused ? "bg-emerald-950" : ""}`}
              style={{ width: 36, height: 36 }}
            >
              <Ionicons name={focused ? "map" : "map-outline"} size={22} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: "Wallet",
          tabBarIcon: ({ color, focused }) => (
            <View
              className={`items-center justify-center rounded-full ${focused ? "bg-emerald-950" : ""}`}
              style={{ width: 36, height: 36 }}
            >
              <Ionicons name={focused ? "wallet" : "wallet-outline"} size={22} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, focused }) => (
            <View
              className={`items-center justify-center rounded-full ${focused ? "bg-emerald-950" : ""}`}
              style={{ width: 36, height: 36 }}
            >
              <Ionicons name={focused ? "settings" : "settings-outline"} size={22} color={color} />
            </View>
          ),
        }}
      />
    </Tabs>
  );
}
