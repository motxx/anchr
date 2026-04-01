import React from "react";
import { View, Pressable, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface BountyTypeToggleProps {
  type: "photo" | "web";
  onTypeChange: (type: "photo" | "web") => void;
}

export function BountyTypeToggle({ type, onTypeChange }: BountyTypeToggleProps) {
  return (
    <View className="flex-row bg-surface rounded-xl border border-border p-1">
      <Pressable
        onPress={() => onTypeChange("photo")}
        className={`flex-1 flex-row items-center justify-center gap-2 py-2.5 rounded-lg ${
          type === "photo" ? "bg-primary/20" : ""
        }`}
      >
        <Ionicons
          name="camera"
          size={18}
          color={type === "photo" ? "#10b981" : "#52525b"}
        />
        <Text
          className={`text-sm font-medium ${
            type === "photo" ? "text-primary" : "text-muted-foreground"
          }`}
        >
          Photo
        </Text>
      </Pressable>

      <Pressable
        onPress={() => onTypeChange("web")}
        className={`flex-1 flex-row items-center justify-center gap-2 py-2.5 rounded-lg ${
          type === "web" ? "bg-primary/20" : ""
        }`}
      >
        <Ionicons
          name="globe"
          size={18}
          color={type === "web" ? "#10b981" : "#52525b"}
        />
        <Text
          className={`text-sm font-medium ${
            type === "web" ? "text-primary" : "text-muted-foreground"
          }`}
        >
          Web Proof
        </Text>
      </Pressable>
    </View>
  );
}
