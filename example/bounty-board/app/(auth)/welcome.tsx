import React, { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { DSText, DSButton } from "../../src/components/ds";
import { useAuthStore } from "../../src/store/auth";
import { Ionicons } from "@expo/vector-icons";

export default function WelcomeScreen() {
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await useAuthStore.getState().generateAndStore();
      router.replace("/(tabs)");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <View className="flex-1 bg-background items-center justify-center px-8">
      <View className="w-20 h-20 rounded-full bg-primary/20 items-center justify-center mb-6">
        <Ionicons name="flash" size={40} color="#10b981" />
      </View>

      <DSText variant="heading" weight="bold" className="text-center mb-2">
        Anchr Bounty Board
      </DSText>
      <DSText variant="body" muted className="text-center mb-12">
        Post bounties for verified photos & data.{"\n"}
        Fulfill them for sats.
      </DSText>

      <View className="w-full gap-3">
        <DSButton
          label="Generate Identity"
          icon="key"
          fullWidth
          loading={generating}
          onPress={handleGenerate}
        />
        <DSButton
          label="Import nsec"
          icon="download"
          variant="secondary"
          fullWidth
          onPress={() => router.push("/(auth)/import-key")}
        />
      </View>
    </View>
  );
}
