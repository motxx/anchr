import React from "react";
import { View, ScrollView, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DSText } from "../../src/components/ds";
import { ProfileHeader } from "../../src/components/profile/ProfileHeader";
import { npubDecode } from "../../src/nostr/nip19";
import { Ionicons } from "@expo/vector-icons";

export default function UserProfileScreen() {
  const { npub } = useLocalSearchParams<{ npub: string }>();
  const insets = useSafeAreaInsets();

  let publicKey = "";
  try {
    publicKey = npubDecode(npub ?? "");
  } catch {
    publicKey = npub ?? "";
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 40 }}
    >
      <View className="flex-row items-center px-4 mb-4">
        <Pressable onPress={() => router.back()} className="mr-3">
          <Ionicons name="arrow-back" size={24} color="#fafafa" />
        </Pressable>
        <DSText variant="heading" weight="bold">Profile</DSText>
      </View>

      <ProfileHeader npub={npub ?? ""} publicKey={publicKey} />
    </ScrollView>
  );
}
