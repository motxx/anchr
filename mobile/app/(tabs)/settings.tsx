import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSettingsStore } from "../../src/store/settings";
import { healthCheck } from "../../src/api/client";

export default function SettingsScreen() {
  const { serverUrl, apiKey, setServerUrl, setApiKey } = useSettingsStore();
  const [urlInput, setUrlInput] = useState(serverUrl);
  const [keyInput, setKeyInput] = useState(apiKey);
  const [checking, setChecking] = useState(false);
  const [connectionOk, setConnectionOk] = useState<boolean | null>(null);

  useEffect(() => {
    setUrlInput(serverUrl);
    setKeyInput(apiKey);
  }, [serverUrl, apiKey]);

  const handleSave = () => {
    setServerUrl(urlInput);
    setApiKey(keyInput);
    Alert.alert("Saved", "Settings updated.");
  };

  const handleTestConnection = async () => {
    setChecking(true);
    setConnectionOk(null);
    // Temporarily set the URL to test
    setServerUrl(urlInput);
    const ok = await healthCheck();
    setConnectionOk(ok);
    setChecking(false);
  };

  return (
    <ScrollView className="flex-1 bg-stone-50" contentContainerStyle={{ padding: 16 }}>
      <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-4">
        Server
      </Text>
      <View className="bg-white rounded-xl border border-gray-200 p-4 gap-4">
        <View>
          <Text className="text-sm font-medium text-gray-700 mb-1">
            Server URL
          </Text>
          <TextInput
            value={urlInput}
            onChangeText={setUrlInput}
            placeholder="https://anchr-app.fly.dev"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900"
          />
        </View>

        <View>
          <Text className="text-sm font-medium text-gray-700 mb-1">
            API Key
          </Text>
          <TextInput
            value={keyInput}
            onChangeText={setKeyInput}
            placeholder="Optional — needed for write endpoints"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900"
          />
        </View>

        <View className="flex-row gap-3">
          <Pressable
            onPress={handleTestConnection}
            disabled={checking}
            className="flex-1 bg-gray-100 rounded-lg py-2.5 items-center flex-row justify-center gap-2"
          >
            <Ionicons
              name={
                connectionOk === true
                  ? "checkmark-circle"
                  : connectionOk === false
                    ? "close-circle"
                    : "pulse-outline"
              }
              size={16}
              color={
                connectionOk === true
                  ? "#10b981"
                  : connectionOk === false
                    ? "#ef4444"
                    : "#6b7280"
              }
            />
            <Text className="text-sm font-medium text-gray-700">
              {checking ? "Testing..." : "Test"}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleSave}
            className="flex-1 bg-emerald-500 rounded-lg py-2.5 items-center"
          >
            <Text className="text-sm font-semibold text-white">Save</Text>
          </Pressable>
        </View>
      </View>

      <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-6">
        About
      </Text>
      <View className="bg-white rounded-xl border border-gray-200 p-4">
        <Text className="text-sm text-gray-700 font-medium">Anchr Worker</Text>
        <Text className="text-xs text-gray-400 mt-1">v0.1.0 — Phase 1</Text>
        <Text className="text-xs text-gray-400 mt-2">
          Ground truth from the street.{"\n"}
          Decentralized photo verification with C2PA, Nostr, and Cashu.
        </Text>
      </View>
    </ScrollView>
  );
}
