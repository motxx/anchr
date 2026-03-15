import React from "react";
import { View, Text } from "react-native";

interface Props {
  nonce: string;
  rule: string;
}

export function ChallengeNonceDisplay({ nonce, rule }: Props) {
  return (
    <View className="bg-amber-50 border border-amber-300 rounded-xl px-5 py-5">
      <Text className="text-[10px] uppercase tracking-[0.3em] text-amber-700 font-semibold mb-3">
        Challenge Nonce
      </Text>
      <Text className="font-mono text-5xl font-black text-amber-600 tracking-[0.4em] leading-none mb-4">
        {nonce}
      </Text>
      <Text className="text-sm text-gray-700 leading-relaxed">
        {rule}
      </Text>
    </View>
  );
}
