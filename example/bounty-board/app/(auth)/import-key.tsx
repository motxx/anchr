import React, { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { DSText, DSInput, DSButton, DSFeedbackBanner } from "../../src/components/ds";
import { useAuthStore } from "../../src/store/auth";
import { isValidNsec, nsecDecode } from "../../src/nostr/nip19";

export default function ImportKeyScreen() {
  const [nsec, setNsec] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const handleImport = async () => {
    setError(null);
    const trimmed = nsec.trim();

    if (!trimmed) {
      setError("Please enter your nsec key");
      return;
    }

    if (!isValidNsec(trimmed)) {
      setError("Invalid nsec format. Must start with nsec1...");
      return;
    }

    setImporting(true);
    try {
      const secretKeyHex = nsecDecode(trimmed);
      await useAuthStore.getState().importSecretKey(secretKeyHex);
      router.replace("/(tabs)");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <View className="flex-1 bg-background px-6 pt-20">
      <DSText variant="heading" weight="bold" className="mb-2">
        Import Identity
      </DSText>
      <DSText variant="body" muted className="mb-8">
        Paste your Nostr secret key (nsec) to restore your identity.
      </DSText>

      {error && (
        <DSFeedbackBanner variant="error" message={error} />
      )}

      <View className="mt-4 gap-4">
        <DSInput
          label="nsec Key"
          value={nsec}
          onChangeText={setNsec}
          placeholder="nsec1..."
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />

        <DSButton
          label="Import"
          icon="download"
          fullWidth
          loading={importing}
          onPress={handleImport}
        />

        <DSButton
          label="Back"
          variant="ghost"
          fullWidth
          onPress={() => router.back()}
        />
      </View>
    </View>
  );
}
