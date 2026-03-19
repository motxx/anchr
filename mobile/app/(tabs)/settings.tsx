import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  Alert,
} from "react-native";
import { useMutation } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useSettingsStore } from "../../src/store/settings";
import { healthCheck } from "../../src/api/client";

export default function SettingsScreen() {
  const { serverUrl, apiKey, setServerUrl, setApiKey } = useSettingsStore();
  const [urlInput, setUrlInput] = useState(serverUrl);
  const [keyInput, setKeyInput] = useState(apiKey);

  const testConnection = useMutation({
    mutationFn: () => healthCheck(urlInput),
  });

  const handleSave = () => {
    setServerUrl(urlInput);
    setApiKey(keyInput);
    Alert.alert("Saved", "Settings updated.");
  };

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ padding: 16 }}>
      <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 mt-4">
        Server
      </Text>
      <View className="bg-surface rounded-xl border border-border p-4 gap-4">
        <View>
          <Text className="text-sm font-medium text-muted-foreground mb-1">
            Server URL
          </Text>
          <TextInput
            value={urlInput}
            onChangeText={setUrlInput}
            placeholder="https://anchr-app.fly.dev"
            placeholderTextColor="#52525b"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            className="bg-surface-raised border border-border rounded-lg px-3 py-2.5 text-sm text-foreground"
          />
        </View>

        <View>
          <Text className="text-sm font-medium text-muted-foreground mb-1">
            API Key
          </Text>
          <TextInput
            value={keyInput}
            onChangeText={setKeyInput}
            placeholder="Optional — needed for write endpoints"
            placeholderTextColor="#52525b"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            className="bg-surface-raised border border-border rounded-lg px-3 py-2.5 text-sm text-foreground"
          />
        </View>

        <View className="flex-row gap-3">
          <Pressable
            onPress={() => testConnection.mutate()}
            disabled={testConnection.isPending}
            className="flex-1 bg-surface-raised rounded-lg py-2.5 items-center flex-row justify-center gap-2"
          >
            <Ionicons
              name={
                testConnection.isSuccess && testConnection.data
                  ? "checkmark-circle"
                  : testConnection.isSuccess && !testConnection.data
                    ? "close-circle"
                    : "pulse-outline"
              }
              size={16}
              color={
                testConnection.isSuccess && testConnection.data
                  ? "#10b981"
                  : testConnection.isSuccess && !testConnection.data
                    ? "#ef4444"
                    : "#6b7280"
              }
            />
            <Text className="text-sm font-medium text-muted-foreground">
              {testConnection.isPending ? "Testing..." : "Test"}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleSave}
            className="flex-1 bg-primary rounded-lg py-2.5 items-center"
          >
            <Text className="text-sm font-semibold text-white">Save</Text>
          </Pressable>
        </View>
      </View>

      <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 mt-6">
        About
      </Text>
      <View className="bg-surface rounded-xl border border-border p-4">
        <Text className="text-sm text-muted-foreground font-medium">Anchr Worker</Text>
        <Text className="text-xs text-muted-foreground mt-1">v0.1.0 — Phase 1</Text>
        <Text className="text-xs text-muted-foreground mt-2">
          Ground truth from the street.{"\n"}
          Decentralized photo verification with C2PA, Nostr, and Cashu.
        </Text>
      </View>
    </ScrollView>
  );
}
