import React, { useRef, useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { cameraProvider, fileToPhoto } from "../src/platform/camera";
import { filePickerProvider } from "../src/platform/file-picker";
import { useQueryDetail } from "../src/hooks/useQueries";
import { ChallengeNonceDisplay } from "../src/components/ChallengeNonceDisplay";
import { StatusBadge } from "../src/components/StatusBadge";
import { uploadPhoto, submitResult } from "../src/api/client";
import { useWalletStore } from "../src/store/wallet";
import { timeLeft, isExpired } from "../src/utils/time";
import type {
  AttachmentRef,
  BlossomKeyMap,
  BlossomKeyMaterial,
  SubmitResponse,
  UploadResponse,
} from "../src/api/types";

/** Formats that browsers/RN can render natively as <Image>. */
const PREVIEWABLE_TYPES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp", "image/svg+xml", "image/bmp",
]);

function FilePreviewCard({ filename, mimeType }: { filename: string; mimeType: string }) {
  const isZip = mimeType === "application/zip";
  return (
    <View className="w-full h-32 rounded-xl bg-gray-100 border border-gray-200 items-center justify-center gap-2">
      <Ionicons name={isZip ? "archive-outline" : "document-outline"} size={32} color="#6b7280" />
      <Text className="text-sm font-medium text-gray-700">{filename}</Text>
      <Text className="text-xs text-gray-400">{isZip ? "ProofMode bundle" : mimeType}</Text>
    </View>
  );
}

function ImagePreviewOrFallback({ uri, filename, mimeType }: { uri: string; filename: string; mimeType: string }) {
  const [failed, setFailed] = useState(false);

  if (failed || !PREVIEWABLE_TYPES.has(mimeType)) {
    return <FilePreviewCard filename={filename} mimeType={mimeType} />;
  }

  return (
    <Image
      source={{ uri }}
      className="w-full h-48 rounded-xl"
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}

export default function QueryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: query, isLoading, isError } = useQueryDetail(id);

  const [cameraActive, setCameraActive] = useState(false);
  const cameraRef = useRef<any>(null);
  const webFileInputRef = useRef<HTMLInputElement | null>(null);

  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [capturedFilename, setCapturedFilename] = useState("photo.jpg");
  const [capturedMimeType, setCapturedMimeType] = useState("image/jpeg");
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);

  const addEarning = useWalletStore((s) => s.addEarning);
  const transactions = useWalletStore((s) => s.transactions);

  // Auto-record earning when query becomes approved (e.g. submitted via API)
  useEffect(() => {
    if (
      query?.status === "approved" &&
      query.bounty &&
      query.payment_status === "released" &&
      !transactions.some((tx) => tx.queryId === query.id)
    ) {
      addEarning({
        queryId: query.id,
        description: query.description,
        amountSats: query.bounty.amount_sats,
        cashuToken: "",
        locationHint: query.location_hint ?? undefined,
        status: "approved",
      });
    }
  }, [query?.status, query?.id]);

  // Submission mutation
  const submitMutation = useMutation<SubmitResponse, Error, void>({
    mutationFn: async () => {
      if (!capturedUri || !query) throw new Error("No photo to submit");

      setUploading(true);
      try {
        // 1. Upload photo
        const uploadRes: UploadResponse = await uploadPhoto(
          query.id,
          capturedUri,
          capturedFilename,
          capturedMimeType,
        );
        if (!uploadRes.ok || !uploadRes.attachment) {
          throw new Error(uploadRes.error ?? "Upload failed");
        }

        // 2. Build encryption keys map
        const attachments: AttachmentRef[] = [uploadRes.attachment];
        const encryptionKeys: BlossomKeyMap = {};
        if (uploadRes.encryption && uploadRes.attachment.id) {
          encryptionKeys[uploadRes.attachment.id] = uploadRes.encryption;
        }

        // 3. Submit result
        const res = await submitResult(query.id, attachments, notes, encryptionKeys);

        // 4. Store earned Cashu token in wallet
        if (res.ok && res.cashu_token && res.bounty_amount_sats) {
          addEarning({
            queryId: query.id,
            description: query.description,
            amountSats: res.bounty_amount_sats,
            cashuToken: res.cashu_token,
            locationHint: query.location_hint ?? undefined,
            status: "approved",
          });
        }

        return res;
      } finally {
        setUploading(false);
      }
    },
  });

  const handleTakePhoto = useCallback(async () => {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({
      quality: 0.9,
      skipProcessing: false,
    });
    if (photo) {
      setCapturedUri(photo.uri);
      setCapturedFilename("photo.jpg");
      setCapturedMimeType("image/jpeg");
      setCameraActive(false);
      if (Platform.OS !== "web") {
        const { deactivateKeepAwake } = await import("expo-keep-awake");
        deactivateKeepAwake();
      }
    }
  }, []);

  const handleOpenCamera = useCallback(async () => {
    if (Platform.OS === "web") {
      // On web, use file input with capture attribute
      if (webFileInputRef.current) {
        webFileInputRef.current.click();
      }
      return;
    }
    // Native: use expo-camera
    const granted = await cameraProvider.requestPermission();
    if (!granted) {
      Alert.alert("Camera Permission", "Camera access is required to take photos.");
      return;
    }
    const { activateKeepAwakeAsync } = await import("expo-keep-awake");
    await activateKeepAwakeAsync();
    setCameraActive(true);
  }, []);

  const handleWebFileChange = useCallback((e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const photo = fileToPhoto(file);
    setCapturedUri(photo.uri);
    setCapturedFilename(photo.filename);
    setCapturedMimeType(photo.mimeType);
    input.value = ""; // Reset so same file can be re-selected
  }, []);

  const handlePickDocument = useCallback(async () => {
    const file = await filePickerProvider.pickFile();
    if (file) {
      setCapturedUri(file.uri);
      setCapturedFilename(file.name);
      setCapturedMimeType(file.mimeType);
    }
  }, []);

  const handleSubmit = useCallback(() => {
    if (!capturedUri) {
      Alert.alert("No Photo", "Take a photo or import a file first.");
      return;
    }
    submitMutation.mutate();
  }, [capturedUri, submitMutation]);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50">
        <ActivityIndicator size="large" color="#10b981" />
      </View>
    );
  }

  if (isError || !query) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50">
        <Ionicons name="alert-circle-outline" size={48} color="#ef4444" />
        <Text className="text-base text-gray-500 mt-3">Query not found</Text>
      </View>
    );
  }

  const expired = isExpired(query.expires_at);
  const submitted = submitMutation.isSuccess && submitMutation.data.ok;

  // Camera fullscreen view (native only — web uses file input)
  if (cameraActive && Platform.OS !== "web") {
    const NativeCameraView = require("expo-camera").CameraView;
    return (
      <View className="flex-1 bg-black">
        <NativeCameraView
          ref={cameraRef}
          className="flex-1"
          facing="back"
        >
          {/* Nonce overlay (only when nonce required) */}
          {query.challenge_nonce && (
            <View className="absolute top-16 left-0 right-0 items-center">
              <View className="bg-black/60 rounded-xl px-5 py-3">
                <Text className="text-amber-400 text-xs text-center mb-1">
                  Write this on paper:
                </Text>
                <Text className="text-amber-300 text-3xl font-black font-mono tracking-[0.3em] text-center">
                  {query.challenge_nonce}
                </Text>
              </View>
            </View>
          )}

          {/* Bottom controls */}
          <View className="absolute bottom-12 left-0 right-0 flex-row items-center justify-center gap-8">
            <Pressable
              onPress={async () => {
                setCameraActive(false);
                const { deactivateKeepAwake } = await import("expo-keep-awake");
                deactivateKeepAwake();
              }}
              className="w-14 h-14 rounded-full bg-white/20 items-center justify-center"
            >
              <Ionicons name="close" size={28} color="white" />
            </Pressable>
            <Pressable
              onPress={handleTakePhoto}
              className="w-20 h-20 rounded-full bg-white border-4 border-white/50 items-center justify-center"
            >
              <View className="w-16 h-16 rounded-full bg-white" />
            </Pressable>
            <View className="w-14 h-14" />
          </View>
        </NativeCameraView>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-stone-50" contentContainerStyle={{ padding: 16 }}>
      {/* Status + Timer */}
      <View className="flex-row items-center justify-between mb-4">
        <StatusBadge status={query.status} />
        <View className="flex-row items-center gap-1">
          <Ionicons name="time-outline" size={14} color="#9ca3af" />
          <Text className="text-sm text-gray-400">{timeLeft(query.expires_at)}</Text>
        </View>
      </View>

      {/* Description */}
      <Text className="text-lg font-semibold text-gray-900 mb-2">
        {query.description}
      </Text>

      {/* Location + Bounty */}
      <View className="flex-row items-center gap-4 mb-5">
        {query.location_hint && (
          <View className="flex-row items-center gap-1">
            <Ionicons name="location-outline" size={14} color="#6b7280" />
            <Text className="text-sm text-gray-500">{query.location_hint}</Text>
          </View>
        )}
        {query.bounty && query.bounty.amount_sats > 0 && (
          <View className="flex-row items-center gap-1">
            <Ionicons name="flash" size={14} color="#f59e0b" />
            <Text className="text-sm font-semibold text-amber-500">
              {query.bounty.amount_sats} sats
            </Text>
          </View>
        )}
      </View>

      {/* Challenge Nonce (only when nonce verification is required) */}
      {query.challenge_nonce && query.challenge_rule && (
        <ChallengeNonceDisplay nonce={query.challenge_nonce} rule={query.challenge_rule} />
      )}

      {/* Action area */}
      {!submitted && !expired && (
        <View className="mt-6 gap-3">
          {/* Photo preview or action buttons */}
          {capturedUri ? (
            <View className="gap-3">
              {capturedMimeType.startsWith("image/") ? (
                <ImagePreviewOrFallback
                  uri={capturedUri}
                  filename={capturedFilename}
                  mimeType={capturedMimeType}
                />
              ) : (
                <FilePreviewCard filename={capturedFilename} mimeType={capturedMimeType} />
              )}
              <Pressable
                onPress={() => setCapturedUri(null)}
                className="self-start"
              >
                <Text className="text-sm text-gray-400">Remove</Text>
              </Pressable>
            </View>
          ) : (
            <View className="flex-row gap-3">
              <Pressable
                onPress={handleOpenCamera}
                className="flex-1 bg-emerald-500 rounded-xl py-3.5 items-center flex-row justify-center gap-2"
              >
                <Ionicons name="camera" size={20} color="white" />
                <Text className="text-white font-semibold">Camera</Text>
              </Pressable>
              <Pressable
                onPress={handlePickDocument}
                className="flex-1 bg-white border border-gray-200 rounded-xl py-3.5 items-center flex-row justify-center gap-2"
              >
                <Ionicons name="document-outline" size={20} color="#6b7280" />
                <Text className="text-gray-700 font-semibold">Import</Text>
              </Pressable>
            </View>
          )}

          {/* Submit */}
          {capturedUri && (
            <Pressable
              onPress={handleSubmit}
              disabled={uploading || submitMutation.isPending}
              className={`rounded-xl py-4 items-center ${
                uploading || submitMutation.isPending
                  ? "bg-emerald-300"
                  : "bg-emerald-500 active:bg-emerald-600"
              }`}
            >
              {uploading || submitMutation.isPending ? (
                <View className="flex-row items-center gap-2">
                  <ActivityIndicator size="small" color="white" />
                  <Text className="text-white font-semibold">
                    {uploading ? "Uploading..." : "Submitting..."}
                  </Text>
                </View>
              ) : (
                <Text className="text-white font-bold text-base">Submit</Text>
              )}
            </Pressable>
          )}
        </View>
      )}

      {/* Success/failure feedback */}
      {submitMutation.isSuccess && (
        <View
          className={`mt-5 p-4 rounded-xl flex-row items-start gap-3 ${
            submitMutation.data.ok
              ? "bg-emerald-50 border border-emerald-200"
              : "bg-red-50 border border-red-200"
          }`}
        >
          <Ionicons
            name={submitMutation.data.ok ? "checkmark-circle" : "alert-circle"}
            size={20}
            color={submitMutation.data.ok ? "#10b981" : "#ef4444"}
          />
          <View className="flex-1">
            <Text
              className={`text-sm font-medium ${
                submitMutation.data.ok ? "text-emerald-700" : "text-red-700"
              }`}
            >
              {submitMutation.data.message}
            </Text>
            {submitMutation.data.ok && submitMutation.data.bounty_amount_sats ? (
              <View className="flex-row items-center gap-1 mt-1.5">
                <Ionicons name="flash" size={12} color="#f59e0b" />
                <Text className="text-sm font-bold text-amber-600">
                  +{submitMutation.data.bounty_amount_sats} sats earned
                </Text>
              </View>
            ) : null}
            {(submitMutation.data.verification?.failures?.length ?? 0) > 0 && (
              <Text className="text-xs text-red-500 mt-1">
                {submitMutation.data.verification!.failures.join(", ")}
              </Text>
            )}
          </View>
        </View>
      )}

      {submitMutation.isError && (
        <View className="mt-5 p-4 rounded-xl bg-red-50 border border-red-200 flex-row items-center gap-3">
          <Ionicons name="alert-circle" size={20} color="#ef4444" />
          <Text className="text-sm text-red-700 flex-1">
            {submitMutation.error.message || "Network error"}
          </Text>
        </View>
      )}

      {/* Expired notice */}
      {expired && !submitted && (
        <View className="mt-5 p-4 rounded-xl bg-gray-100 items-center">
          <Text className="text-sm text-gray-500">This query has expired</Text>
        </View>
      )}

      {/* Verification detail (if available) */}
      {query.verification && (
        <View className="mt-5 p-4 rounded-xl bg-white border border-gray-200">
          <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Verification
          </Text>
          {query.verification.checks.map((check, i) => (
            <View key={i} className="flex-row items-start gap-2 mb-1">
              <Ionicons name="checkmark-circle" size={14} color="#10b981" />
              <Text className="text-xs text-gray-600 flex-1">{check}</Text>
            </View>
          ))}
          {query.verification.failures.map((fail, i) => (
            <View key={i} className="flex-row items-start gap-2 mb-1">
              <Ionicons name="close-circle" size={14} color="#ef4444" />
              <Text className="text-xs text-red-600 flex-1">{fail}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Hidden file input for web camera capture */}
      {Platform.OS === "web" && (
        <input
          ref={(el: any) => {
            if (el && webFileInputRef.current !== el) {
              webFileInputRef.current = el;
              el.addEventListener("change", handleWebFileChange);
            }
          }}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
        />
      )}
    </ScrollView>
  );
}
