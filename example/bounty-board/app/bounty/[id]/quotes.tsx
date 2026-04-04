import React, { useState } from "react";
import { View, ScrollView, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DSText, DSFeedbackBanner } from "../../../src/components/ds";
import { QuoteList } from "../../../src/components/bounty/QuoteList";
import { selectWorker } from "../../../src/api/client";
import { Ionicons } from "@expo/vector-icons";
import type { QuoteInfo } from "../../../src/api/types";

export default function QuotesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // TODO: fetch actual quotes from API or Nostr events
  const quotes: QuoteInfo[] = [];

  const handleSelect = async (workerPubkey: string) => {
    if (!id) return;
    setSelecting(true);
    setError(null);
    try {
      await selectWorker(id, workerPubkey);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Selection failed");
    } finally {
      setSelecting(false);
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 40 }}
    >
      <View className="flex-row items-center px-4 mb-4">
        <Pressable onPress={() => router.back()} className="mr-3">
          <Ionicons name="arrow-back" size={24} color="#fafafa" />
        </Pressable>
        <DSText variant="heading" weight="bold">Worker Quotes</DSText>
      </View>

      <View className="px-4 gap-4">
        {error && <DSFeedbackBanner variant="error" message={error} />}
        <QuoteList quotes={quotes} onSelectWorker={handleSelect} selecting={selecting} />
      </View>
    </ScrollView>
  );
}
