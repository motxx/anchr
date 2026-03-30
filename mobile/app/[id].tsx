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
  TextInput,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { cameraProvider, fileToPhoto } from "../src/platform/camera";
import { filePickerProvider } from "../src/platform/file-picker";
import { useQueryDetail } from "../src/hooks/useQueries";
import { ChallengeNonceDisplay } from "../src/components/ChallengeNonceDisplay";
import { StatusBadge } from "../src/components/StatusBadge";
import { QueryTypeBadge } from "../src/components/QueryTypeBadge";
import { uploadPhoto, submitResult } from "../src/api/client";
import { useWalletStore } from "../src/store/wallet";
import { timeLeft, isExpired } from "../src/utils/time";
import type {
  AttachmentRef,
  BlossomKeyMap,
  SubmitResponse,
  TlsnRequirement,
  TlsnVerifiedData,
  UploadResponse,
} from "../src/api/types";

/** Formats that browsers/RN can render natively as <Image>. */
const PREVIEWABLE_TYPES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp", "image/svg+xml", "image/bmp",
]);

function FilePreviewCard({ filename, mimeType }: { filename: string; mimeType: string }) {
  const isZip = mimeType === "application/zip";
  return (
    <View className="w-full h-32 rounded-2xl bg-surface-raised border border-border items-center justify-center gap-2">
      <Ionicons name={isZip ? "archive-outline" : "document-outline"} size={32} color="#6b7280" />
      <Text className="text-sm font-medium text-muted-foreground">{filename}</Text>
      <Text className="text-xs text-muted-foreground">{isZip ? "ProofMode bundle" : mimeType}</Text>
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
      className="w-full h-48 rounded-2xl"
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}

function TlsnProofSection({
  verified,
  requirement,
}: {
  verified: TlsnVerifiedData;
  requirement?: TlsnRequirement | null;
}) {
  const [showBody, setShowBody] = useState(false);

  let bodyDisplay: string;
  let isJson = false;
  try {
    bodyDisplay = JSON.stringify(JSON.parse(verified.revealed_body), null, 2);
    isJson = true;
  } catch {
    bodyDisplay = verified.revealed_body;
  }

  const timestamp = new Date(verified.session_timestamp * 1000).toLocaleString();

  return (
    <View className="mt-5 p-5 rounded-2xl bg-surface border border-border">
      <Text className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">
        TLSNotary Proof (cryptographically verified)
      </Text>

      {/* Server */}
      <View className="mb-3 gap-1.5">
        <View className="flex-row items-center gap-2">
          <Ionicons name="lock-closed" size={14} color="#10b981" />
          <Text className="text-[15px] font-semibold text-foreground">
            {verified.server_name}
          </Text>
        </View>
      </View>

      {/* Conditions */}
      {requirement?.conditions && requirement.conditions.length > 0 && (
        <View className="mb-3 gap-1.5">
          <Text className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">
            Conditions
          </Text>
          {requirement.conditions.map((cond, i) => (
            <View key={i} className="flex-row items-start gap-2">
              <Ionicons name="checkmark-circle" size={13} color="#10b981" />
              <Text className="text-xs text-muted-foreground flex-1">
                {cond.description ?? `${cond.type}: ${cond.expression}`}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Server Response (collapsible) */}
      <Pressable
        onPress={() => setShowBody((v) => !v)}
        className="mb-2 flex-row items-center gap-1.5"
      >
        <Ionicons
          name={showBody ? "chevron-down" : "chevron-forward"}
          size={14}
          color="#6b7280"
        />
        <Text className="text-xs font-semibold text-muted-foreground">
          Server Response
        </Text>
        {isJson && (
          <View className="bg-blue-900/30 rounded-full px-2 py-0.5">
            <Text className="text-[9px] text-blue-400 font-bold">JSON</Text>
          </View>
        )}
      </Pressable>
      {showBody && (
        <View className="bg-black/40 rounded-xl p-3 mb-3">
          <ScrollView horizontal={!isJson} nestedScrollEnabled>
            <Text className="text-xs text-emerald-300 font-mono" selectable>
              {bodyDisplay}
            </Text>
          </ScrollView>
        </View>
      )}

      {/* Timestamp */}
      <Text className="text-[10px] text-muted-foreground">
        {timestamp}
      </Text>
    </View>
  );
}

/** Status info for TLSNotary queries that are being auto-fulfilled */
function TlsnStatusPanel({ query }: { query: { status: string; tlsn_requirements?: TlsnRequirement | null } }) {
  const isPending = query.status === "pending";
  const isProcessing = query.status === "processing" || query.status === "verifying";
  const isApproved = query.status === "approved";
  const isRejected = query.status === "rejected";

  return (
    <View className="mt-5 p-5 rounded-2xl bg-surface border border-border gap-3">
      <View className="flex-row items-center gap-2">
        <View className="w-8 h-8 rounded-full items-center justify-center" style={{ backgroundColor: "rgba(96,165,250,0.12)" }}>
          <Ionicons name="globe-outline" size={16} color="#60a5fa" />
        </View>
        <Text className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
          Web Proof — Auto-Worker
        </Text>
      </View>

      {/* Target URL */}
      {query.tlsn_requirements?.target_url && (
        <View className="bg-black/30 rounded-xl px-3.5 py-2.5">
          <View className="flex-row items-center gap-1.5 mb-1">
            <Ionicons name="lock-closed" size={10} color="#60a5fa" />
            <Text className="text-xs text-blue-400 font-semibold" numberOfLines={1}>
              {query.tlsn_requirements.target_url}
            </Text>
          </View>
          {query.tlsn_requirements.conditions?.map((cond, i) => (
            <Text key={i} className="text-[11px] text-muted-foreground ml-4">
              {cond.description ?? `${cond.type}: ${cond.expression}`}
            </Text>
          ))}
        </View>
      )}

      {/* Status message */}
      {isPending && (
        <View className="flex-row items-center gap-2.5">
          <ActivityIndicator size="small" color="#60a5fa" />
          <Text className="text-[13px] text-blue-400 font-medium">
            Waiting for Auto-Worker to pick up...
          </Text>
        </View>
      )}
      {isProcessing && (
        <View className="flex-row items-center gap-2.5">
          <ActivityIndicator size="small" color="#f59e0b" />
          <Text className="text-[13px] text-amber-400 font-medium">
            Running MPC-TLS proof...
          </Text>
        </View>
      )}
      {isApproved && (
        <View className="flex-row items-center gap-2.5">
          <Ionicons name="checkmark-circle" size={18} color="#10b981" />
          <Text className="text-[13px] text-emerald-400 font-medium">
            Proof verified successfully
          </Text>
        </View>
      )}
      {isRejected && (
        <View className="flex-row items-center gap-2.5">
          <Ionicons name="close-circle" size={18} color="#ef4444" />
          <Text className="text-[13px] text-red-400 font-medium">
            Verification failed
          </Text>
        </View>
      )}

      <Text className="text-[11px] text-muted-foreground">
        TLSNotary queries are automatically fulfilled by the Auto-Worker daemon via MPC-TLS.
      </Text>
    </View>
  );
}

export default function QueryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: query, isLoading, isError } = useQueryDetail(id);
  const router = useRouter();

  const [cameraActive, setCameraActive] = useState(false);
  const cameraRef = useRef<any>(null);
  const webFileInputRef = useRef<HTMLInputElement | null>(null);

  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [capturedFilename, setCapturedFilename] = useState("photo.jpg");
  const [capturedMimeType, setCapturedMimeType] = useState("image/jpeg");
  const [notes, setNotes] = useState("");

  const addEarning = useWalletStore((s) => s.addEarning);

  // Auto-record earning when query becomes approved (e.g. submitted via API)
  useEffect(() => {
    if (
      query?.status === "approved" &&
      query.bounty &&
      query.payment_status === "released"
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
      if (webFileInputRef.current) {
        webFileInputRef.current.click();
      }
      return;
    }
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
    input.value = "";
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
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color="#10b981" />
      </View>
    );
  }

  if (isError || !query) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <View className="w-16 h-16 rounded-full bg-red-950 items-center justify-center mb-4">
          <Ionicons name="alert-circle-outline" size={28} color="#ef4444" />
        </View>
        <Text className="text-base font-semibold text-foreground">Query not found</Text>
      </View>
    );
  }

  const expired = isExpired(query.expires_at);
  const submitted = submitMutation.isSuccess && submitMutation.data.ok;
  const isTlsnOnly = query.verification_requirements.includes("tlsn") &&
    !query.verification_requirements.includes("nonce") &&
    !query.verification_requirements.includes("gps");

  // Camera fullscreen view (native only)
  if (cameraActive && Platform.OS !== "web") {
    const NativeCameraView = require("expo-camera").CameraView;
    return (
      <View className="flex-1 bg-black">
        <NativeCameraView
          ref={cameraRef}
          className="flex-1"
          facing="back"
        >
          {query.challenge_nonce && (
            <View className="absolute top-16 left-0 right-0 items-center">
              <View className="bg-black/60 rounded-2xl px-5 py-3">
                <Text className="text-amber-400 text-xs text-center mb-1">
                  Write this on paper:
                </Text>
                <Text className="text-amber-300 text-3xl font-black font-mono tracking-[0.3em] text-center">
                  {query.challenge_nonce}
                </Text>
              </View>
            </View>
          )}

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
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ padding: 20, paddingTop: 60 }}>
      {/* Back button */}
      <Pressable
        onPress={() => router.back()}
        className="flex-row items-center gap-1.5 mb-5"
      >
        <Ionicons name="chevron-back" size={20} color="#a1a1aa" />
        <Text className="text-[13px] text-muted-foreground font-medium">Back</Text>
      </Pressable>

      {/* Status + Type + Timer */}
      <View className="flex-row items-center justify-between mb-4">
        <View className="flex-row items-center gap-2">
          <QueryTypeBadge requirements={query.verification_requirements} />
          <StatusBadge status={query.status} />
        </View>
        <View className="flex-row items-center gap-1.5 bg-surface rounded-full px-3 py-1.5">
          <Ionicons name="time-outline" size={12} color="#52525b" />
          <Text className="text-[11px] font-semibold text-muted-foreground">{timeLeft(query.expires_at)}</Text>
        </View>
      </View>

      {/* Description */}
      <Text className="text-xl font-bold text-foreground mb-3">
        {query.description}
      </Text>

      {/* Location + Bounty */}
      <View className="flex-row items-center gap-4 mb-5">
        {query.location_hint && (
          <View className="flex-row items-center gap-1.5">
            <Ionicons name="location-outline" size={14} color="#6b7280" />
            <Text className="text-[13px] text-muted-foreground">{query.location_hint}</Text>
          </View>
        )}
        {query.bounty && query.bounty.amount_sats > 0 && (
          <View className="bg-emerald-950 rounded-full px-3.5 py-1.5 flex-row items-center gap-1.5">
            <Ionicons name="flash" size={13} color="#10b981" />
            <Text className="text-[13px] font-bold text-primary">
              {query.bounty.amount_sats} sats
            </Text>
          </View>
        )}
      </View>

      {/* Challenge Nonce */}
      {query.challenge_nonce && query.challenge_rule && (
        <ChallengeNonceDisplay nonce={query.challenge_nonce} rule={query.challenge_rule} />
      )}

      {/* TLSNotary status panel (for tlsn-only queries) */}
      {isTlsnOnly && (
        <TlsnStatusPanel query={query} />
      )}

      {/* Action area (photo queries only) */}
      {!submitted && !expired && !isTlsnOnly && (
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
                className="self-start flex-row items-center gap-1.5"
              >
                <Ionicons name="trash-outline" size={14} color="#6b7280" />
                <Text className="text-[13px] text-muted-foreground">Remove</Text>
              </Pressable>
            </View>
          ) : (
            <View className="flex-row gap-3">
              <Pressable
                onPress={handleOpenCamera}
                className="flex-1 bg-primary rounded-2xl py-4 items-center flex-row justify-center gap-2.5 active:opacity-80"
              >
                <Ionicons name="camera" size={20} color="white" />
                <Text className="text-white font-bold text-[15px]">Camera</Text>
              </Pressable>
              <Pressable
                onPress={handlePickDocument}
                className="flex-1 bg-surface border border-border rounded-2xl py-4 items-center flex-row justify-center gap-2.5 active:opacity-80"
              >
                <Ionicons name="document-outline" size={20} color="#6b7280" />
                <Text className="text-muted-foreground font-bold text-[15px]">Import</Text>
              </Pressable>
            </View>
          )}

          {/* Notes input */}
          {capturedUri && (
            <View>
              <Text className="text-[13px] font-semibold text-muted-foreground mb-2">
                Notes (optional)
              </Text>
              <TextInput
                className="bg-surface border border-border rounded-xl px-4 py-3 text-[15px] text-foreground"
                placeholder="Add context about this photo..."
                placeholderTextColor="#52525b"
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={2}
              />
            </View>
          )}

          {/* Submit */}
          {capturedUri && (
            <Pressable
              onPress={handleSubmit}
              disabled={submitMutation.isPending}
              className={`rounded-2xl py-4.5 items-center active:opacity-80 ${
                submitMutation.isPending
                  ? "bg-emerald-300"
                  : "bg-primary"
              }`}
            >
              {submitMutation.isPending ? (
                <View className="flex-row items-center gap-2">
                  <ActivityIndicator size="small" color="white" />
                  <Text className="text-white font-bold text-[15px]">Submitting...</Text>
                </View>
              ) : (
                <Text className="text-white font-black text-base">Submit Proof</Text>
              )}
            </Pressable>
          )}
        </View>
      )}

      {/* Success feedback — Orbix-style centered success card */}
      {submitMutation.isSuccess && submitMutation.data.ok && (
        <View className="mt-8 items-center">
          <View className="bg-surface rounded-3xl p-8 items-center border border-border w-full">
            <View className="w-20 h-20 rounded-full bg-emerald-950 items-center justify-center mb-5">
              <Ionicons name="checkmark" size={40} color="#10b981" />
            </View>
            <Text className="text-xl font-black text-foreground mb-2">
              Proof Submitted
            </Text>
            <Text className="text-[13px] text-muted-foreground text-center mb-4">
              {submitMutation.data.message}
            </Text>
            {submitMutation.data.bounty_amount_sats ? (
              <View className="bg-emerald-950 rounded-full px-5 py-2.5 flex-row items-center gap-2">
                <Ionicons name="flash" size={16} color="#10b981" />
                <Text className="text-lg font-black text-primary">
                  +{submitMutation.data.bounty_amount_sats} sats
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      )}

      {/* Failure feedback */}
      {submitMutation.isSuccess && !submitMutation.data.ok && (
        <View className="mt-5 p-5 rounded-2xl bg-red-950/30 border border-red-800 flex-row items-start gap-3">
          <Ionicons name="alert-circle" size={20} color="#ef4444" />
          <View className="flex-1">
            <Text className="text-[13px] font-semibold text-red-400">
              {submitMutation.data.message}
            </Text>
            {(submitMutation.data.verification?.failures?.length ?? 0) > 0 && (
              <Text className="text-xs text-red-400 mt-1">
                {submitMutation.data.verification!.failures.join(", ")}
              </Text>
            )}
          </View>
        </View>
      )}

      {submitMutation.isError && (
        <View className="mt-5 p-5 rounded-2xl bg-red-950/30 border border-red-800 flex-row items-center gap-3">
          <Ionicons name="alert-circle" size={20} color="#ef4444" />
          <Text className="text-[13px] text-red-400 flex-1 font-medium">
            {submitMutation.error.message || "Network error"}
          </Text>
        </View>
      )}

      {/* Expired notice */}
      {expired && !submitted && (
        <View className="mt-5 p-5 rounded-2xl bg-surface items-center">
          <View className="w-14 h-14 rounded-full bg-surface-raised items-center justify-center mb-3">
            <Ionicons name="time-outline" size={24} color="#52525b" />
          </View>
          <Text className="text-[15px] font-semibold text-muted-foreground">This query has expired</Text>
        </View>
      )}

      {/* Verification detail */}
      {query.verification && (
        <View className="mt-5 p-5 rounded-2xl bg-surface border border-border">
          <Text className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">
            Verification
          </Text>
          {query.verification.checks.map((check, i) => (
            <View key={i} className="flex-row items-start gap-2 mb-1.5">
              <Ionicons name="checkmark-circle" size={14} color="#10b981" />
              <Text className="text-xs text-muted-foreground flex-1">{check}</Text>
            </View>
          ))}
          {query.verification.failures.map((fail, i) => (
            <View key={i} className="flex-row items-start gap-2 mb-1.5">
              <Ionicons name="close-circle" size={14} color="#ef4444" />
              <Text className="text-xs text-red-400 flex-1">{fail}</Text>
            </View>
          ))}
        </View>
      )}

      {/* TLSNotary Proof detail */}
      {(query.verification?.tlsn_verified || query.result?.tlsn_verified) && (
        <TlsnProofSection
          verified={(query.verification?.tlsn_verified || query.result?.tlsn_verified)!}
          requirement={query.tlsn_requirements}
        />
      )}

      {/* Hidden file input for web camera capture */}
      {Platform.OS === "web" && (
        <input
          ref={(el: any) => { webFileInputRef.current = el; }}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={handleWebFileChange as any}
        />
      )}

      {/* Bottom spacing */}
      <View className="h-8" />
    </ScrollView>
  );
}
