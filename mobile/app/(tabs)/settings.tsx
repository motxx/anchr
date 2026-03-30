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
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
      <Text className="text-2xl font-black text-foreground tracking-tight pt-16 mb-6">
        Settings
      </Text>

      {/* Server section */}
      <View className="flex-row items-center gap-2.5 mb-3">
        <View className="w-7 h-7 rounded-full bg-surface-raised items-center justify-center">
          <Ionicons name="server-outline" size={13} color="#a1a1aa" />
        </View>
        <Text className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
          Server
        </Text>
      </View>

      <View className="bg-surface rounded-2xl p-5 gap-5">
        <View>
          <Text className="text-[13px] font-semibold text-muted-foreground mb-2">
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
            className="bg-background border border-border rounded-xl px-4 py-3 text-[15px] text-foreground"
          />
        </View>

        <View>
          <Text className="text-[13px] font-semibold text-muted-foreground mb-2">
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
            className="bg-background border border-border rounded-xl px-4 py-3 text-[15px] text-foreground"
          />
        </View>

        <View className="flex-row gap-3">
          <Pressable
            onPress={() => testConnection.mutate()}
            disabled={testConnection.isPending}
            className="flex-1 bg-surface-raised rounded-xl py-3 items-center flex-row justify-center gap-2 active:opacity-80"
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
            <Text className="text-[13px] font-semibold text-muted-foreground">
              {testConnection.isPending ? "Testing..." : "Test"}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleSave}
            className="flex-1 bg-primary rounded-xl py-3 items-center active:opacity-80"
          >
            <Text className="text-[13px] font-bold text-white">Save</Text>
          </Pressable>
        </View>
      </View>

      {/* About section */}
      <View className="flex-row items-center gap-2.5 mb-3 mt-8">
        <View className="w-7 h-7 rounded-full bg-surface-raised items-center justify-center">
          <Ionicons name="information-circle-outline" size={13} color="#a1a1aa" />
        </View>
        <Text className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
          About
        </Text>
      </View>

      <View className="bg-surface rounded-2xl p-5">
        <View className="flex-row items-center gap-3 mb-3">
          <View className="w-10 h-10 rounded-full bg-emerald-950 items-center justify-center">
            <Ionicons name="shield-checkmark" size={20} color="#10b981" />
          </View>
          <View>
            <Text className="text-[15px] text-foreground font-semibold">Anchr Worker</Text>
            <Text className="text-[11px] text-muted-foreground mt-0.5">v0.1.0 — Phase 1</Text>
          </View>
        </View>
        <Text className="text-[13px] text-muted-foreground leading-5">
          Ground truth from the street.{"\n"}
          Decentralized photo verification with C2PA, Nostr, and Cashu.
        </Text>
      </View>
    </ScrollView>
  );
}
