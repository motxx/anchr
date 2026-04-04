import React from "react";
import { View, Pressable, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";

const ROUTE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: "list",
  map: "map",
  create: "add",
  wallet: "wallet",
  profile: "person",
};

export function DSTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  return (
    <View className="flex-row bg-surface border-t border-border pb-6 pt-2 px-2">
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key]!;
        const isFocused = state.index === index;
        const isCreate = route.name === "create";

        const onPress = () => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        if (isCreate) {
          return (
            <View key={route.key} className="flex-1 items-center -mt-5">
              <Pressable
                onPress={onPress}
                className="w-14 h-14 rounded-full bg-primary items-center justify-center shadow-lg active:bg-primary-hover"
              >
                <Ionicons name="add" size={28} color="#fff" />
              </Pressable>
            </View>
          );
        }

        const iconName = ROUTE_ICONS[route.name] ?? "ellipse";
        const label = typeof options.tabBarLabel === "string"
          ? options.tabBarLabel
          : options.title ?? route.name;

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            className="flex-1 items-center py-1"
          >
            <Ionicons
              name={iconName}
              size={22}
              color={isFocused ? "#10b981" : "#52525b"}
            />
            <Text
              className={`text-[10px] mt-0.5 ${
                isFocused ? "text-primary font-medium" : "text-subtle"
              }`}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
