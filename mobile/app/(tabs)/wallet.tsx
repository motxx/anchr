import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function WalletScreen() {
  return (
    <View className="flex-1 bg-stone-50 items-center justify-center px-6">
      <View className="items-center gap-3">
        <View className="w-16 h-16 rounded-full bg-amber-50 items-center justify-center">
          <Ionicons name="wallet-outline" size={32} color="#f59e0b" />
        </View>
        <Text className="text-lg font-semibold text-gray-900">Wallet</Text>
        <Text className="text-2xl font-bold text-gray-900">0 sats</Text>
        <Text className="text-sm text-gray-500 text-center">
          Earn sats by completing queries.{"\n"}
          Cashu ecash wallet coming in Phase 4.
        </Text>
      </View>
    </View>
  );
}
