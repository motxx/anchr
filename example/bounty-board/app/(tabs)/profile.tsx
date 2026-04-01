import React from "react";
import { View, ScrollView, Alert } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DSText, DSButton, DSDivider, DSSection } from "../../src/components/ds";
import { ProfileHeader } from "../../src/components/profile/ProfileHeader";
import { SettingsForm } from "../../src/components/profile/SettingsForm";
import { useAuthStore } from "../../src/store/auth";
import { nsecEncode } from "../../src/nostr/nip19";
import { clipboardProvider } from "../../src/platform/clipboard";

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { npub, publicKey, secretKeyHex, logout } = useAuthStore();

  if (!npub || !publicKey || !secretKeyHex) return null;

  const handleExportNsec = async () => {
    const nsec = nsecEncode(secretKeyHex);
    await clipboardProvider.copyText(nsec);
    Alert.alert("Copied", "Your nsec has been copied to clipboard. Keep it safe!");
  };

  const handleLogout = () => {
    Alert.alert(
      "Logout",
      "Make sure you've exported your nsec. You won't be able to recover this identity without it.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Logout",
          style: "destructive",
          onPress: async () => {
            await logout();
            router.replace("/(auth)/welcome");
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: 40 }}
    >
      <ProfileHeader npub={npub} publicKey={publicKey} />

      <DSDivider className="mx-4 my-2" />

      <SettingsForm />

      <View className="px-4 mt-6 gap-3">
        <DSSection title="IDENTITY">
          <View className="gap-3">
            <DSButton
              label="Export nsec"
              icon="key"
              variant="secondary"
              fullWidth
              onPress={handleExportNsec}
            />
            <DSButton
              label="Logout"
              icon="log-out"
              variant="destructive"
              fullWidth
              onPress={handleLogout}
            />
          </View>
        </DSSection>
      </View>
    </ScrollView>
  );
}
