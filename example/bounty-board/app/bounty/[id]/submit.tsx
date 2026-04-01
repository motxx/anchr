import React, { useState } from "react";
import { View, ScrollView, Image, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DSText, DSButton, DSInput, DSCard, DSSection, DSFeedbackBanner } from "../../../src/components/ds";
import { uploadPhoto, submitResult, submitQuote } from "../../../src/api/client";
import { useQueryDetail } from "../../../src/hooks/useQueries";
import { cameraProvider, type CapturedPhoto } from "../../../src/platform/camera";
import { filePickerProvider } from "../../../src/platform/file-picker";
import { Ionicons } from "@expo/vector-icons";
import type { AttachmentRef } from "../../../src/api/types";

export default function SubmitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { data: bounty } = useQueryDetail(id ?? "");

  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const isQuotePhase = bounty?.status === "pending" || bounty?.status === "awaiting_quotes";

  const handleTakePhoto = async () => {
    const granted = await cameraProvider.requestPermission();
    if (!granted) {
      setError("Camera permission denied");
      return;
    }
    // On native, we'd use CameraView. For now, use file picker as fallback.
    const file = await filePickerProvider.pickFile(["image/*"]);
    if (file) {
      setPhoto({ uri: file.uri, filename: file.name, mimeType: file.mimeType });
    }
  };

  const handlePickFile = async () => {
    const file = await filePickerProvider.pickFile(["image/*"]);
    if (file) {
      setPhoto({ uri: file.uri, filename: file.name, mimeType: file.mimeType });
    }
  };

  const handleSubmitQuote = async () => {
    if (!id) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitQuote(id);
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Quote failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitProof = async () => {
    if (!id || !photo) return;
    setSubmitting(true);
    setError(null);

    try {
      const uploadRes = await uploadPhoto(id, photo.uri, photo.filename, photo.mimeType);
      if (!uploadRes.ok || !uploadRes.attachment) {
        throw new Error(uploadRes.error ?? "Upload failed");
      }

      const attachments: AttachmentRef[] = [uploadRes.attachment];
      const result = await submitResult(id, attachments, notes);

      if (result.ok) {
        setSuccess(true);
      } else {
        setError(result.message ?? "Submission failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <View className="flex-1 bg-background items-center justify-center px-6">
        <Ionicons name="checkmark-circle" size={64} color="#10b981" />
        <DSText variant="heading" weight="bold" className="mt-4 text-center">
          {isQuotePhase ? "Quote Submitted!" : "Proof Submitted!"}
        </DSText>
        <DSText variant="body" muted className="mt-2 text-center">
          {isQuotePhase
            ? "The requester will review your quote."
            : "Your proof is being verified."}
        </DSText>
        <DSButton
          label="Back to Bounty"
          variant="secondary"
          className="mt-6"
          onPress={() => router.back()}
        />
      </View>
    );
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
        <DSText variant="heading" weight="bold">
          {isQuotePhase ? "Submit Quote" : "Submit Proof"}
        </DSText>
      </View>

      <View className="px-4 gap-4">
        {error && <DSFeedbackBanner variant="error" message={error} />}

        {isQuotePhase ? (
          <>
            <DSCard>
              <DSText variant="body" muted>
                Submit a quote to let the requester know you can fulfill this bounty.
              </DSText>
            </DSCard>
            <DSButton
              label="Submit Quote"
              icon="hand-right"
              fullWidth
              loading={submitting}
              onPress={handleSubmitQuote}
            />
          </>
        ) : (
          <>
            <DSSection title="PHOTO PROOF">
              <DSCard className="gap-3">
                {photo ? (
                  <View>
                    <Image
                      source={{ uri: photo.uri }}
                      className="w-full h-48 rounded-lg"
                      resizeMode="cover"
                    />
                    <Pressable
                      onPress={() => setPhoto(null)}
                      className="absolute top-2 right-2 bg-black/60 rounded-full p-1"
                    >
                      <Ionicons name="close" size={18} color="#fff" />
                    </Pressable>
                  </View>
                ) : (
                  <View className="gap-2">
                    <DSButton
                      label="Take Photo"
                      icon="camera"
                      variant="secondary"
                      fullWidth
                      onPress={handleTakePhoto}
                    />
                    <DSButton
                      label="Pick File"
                      icon="document"
                      variant="ghost"
                      fullWidth
                      onPress={handlePickFile}
                    />
                  </View>
                )}
              </DSCard>
            </DSSection>

            <DSSection title="NOTES">
              <DSCard>
                <DSInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Optional notes about this submission..."
                  multiline
                  numberOfLines={3}
                />
              </DSCard>
            </DSSection>

            <DSButton
              label="Submit Proof"
              icon="cloud-upload"
              fullWidth
              loading={submitting}
              disabled={!photo}
              onPress={handleSubmitProof}
            />
          </>
        )}
      </View>
    </ScrollView>
  );
}
