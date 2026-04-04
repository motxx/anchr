import React from "react";
import { View, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DSText, DSCard, DSSection, DSBadge, DSSatsAmount, DSDivider, DSButton } from "../../../src/components/ds";
import { StatusTimeline } from "../../../src/components/bounty/StatusTimeline";
import { VerificationResults } from "../../../src/components/bounty/VerificationResults";
import { useQueryDetail } from "../../../src/hooks/useQueries";
import { useAuthStore } from "../../../src/store/auth";
import { timeLeft, isExpired, formatShortTime } from "../../../src/utils/time";
import { formatStatus } from "../../../src/utils/format";
import { Ionicons } from "@expo/vector-icons";

export default function BountyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { data: bounty, isLoading } = useQueryDetail(id ?? "");
  const publicKey = useAuthStore((s) => s.publicKey);

  if (isLoading || !bounty) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="#10b981" />
      </View>
    );
  }

  const expired = isExpired(bounty.expires_at);
  const isPhoto = !bounty.tlsn_requirements;

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 40 }}
    >
      {/* Header */}
      <View className="flex-row items-center px-4 mb-4">
        <Pressable onPress={() => router.back()} className="mr-3">
          <Ionicons name="arrow-back" size={24} color="#fafafa" />
        </Pressable>
        <View className="flex-1">
          <DSText variant="heading" weight="bold" numberOfLines={2}>
            {bounty.description}
          </DSText>
        </View>
      </View>

      {/* Status Timeline */}
      <View className="px-4 mb-4">
        <StatusTimeline status={bounty.status} />
      </View>

      {/* Info Cards */}
      <View className="px-4 gap-3">
        <DSCard>
          <View className="flex-row items-center justify-between mb-2">
            <DSBadge label={formatStatus(bounty.status)} variant={
              bounty.status === "approved" ? "success" :
              bounty.status === "rejected" ? "error" :
              expired ? "muted" : "default"
            } />
            <View className="flex-row items-center gap-1">
              <Ionicons name={isPhoto ? "camera" : "globe"} size={14} color="#a1a1aa" />
              <DSText variant="caption" muted>{isPhoto ? "Photo" : "Web Proof"}</DSText>
            </View>
          </View>

          <DSDivider className="my-2" />

          <View className="gap-2">
            {bounty.bounty && (
              <View className="flex-row items-center justify-between">
                <DSText variant="body" muted>Bounty</DSText>
                <DSSatsAmount amount={bounty.bounty.amount_sats} />
              </View>
            )}

            <View className="flex-row items-center justify-between">
              <DSText variant="body" muted>Time Left</DSText>
              <DSText variant="body" weight="medium" color={expired ? "text-destructive" : undefined}>
                {expired ? "Expired" : timeLeft(bounty.expires_at)}
              </DSText>
            </View>

            {bounty.location_hint && (
              <View className="flex-row items-center justify-between">
                <DSText variant="body" muted>Location</DSText>
                <DSText variant="body">{bounty.location_hint}</DSText>
              </View>
            )}

            <View className="flex-row items-center justify-between">
              <DSText variant="body" muted>Created</DSText>
              <DSText variant="body">{formatShortTime(bounty.created_at)}</DSText>
            </View>

            <View className="flex-row items-center justify-between">
              <DSText variant="body" muted>Quotes</DSText>
              <DSText variant="body">{bounty.quotes_count}</DSText>
            </View>
          </View>
        </DSCard>

        {/* TLSNotary Requirements */}
        {bounty.tlsn_requirements && (
          <DSSection title="WEB PROOF REQUIREMENTS">
            <DSCard>
              <DSText variant="mono" numberOfLines={2}>
                {bounty.tlsn_requirements.target_url}
              </DSText>
              {bounty.tlsn_requirements.conditions?.map((c, i) => (
                <View key={i} className="flex-row items-center gap-2 mt-1">
                  <Ionicons name="code-slash" size={12} color="#a1a1aa" />
                  <DSText variant="caption" muted>{c.type}: {c.expression}</DSText>
                </View>
              ))}
            </DSCard>
          </DSSection>
        )}

        {/* Verification Results */}
        {bounty.verification && (
          <DSSection title="VERIFICATION">
            <VerificationResults verification={bounty.verification} />
          </DSSection>
        )}

        {/* Actions */}
        <View className="gap-2 mt-2">
          {bounty.status === "awaiting_quotes" && (
            <DSButton
              label="View Quotes"
              icon="people"
              variant="secondary"
              fullWidth
              onPress={() => router.push(`/bounty/${id}/quotes`)}
            />
          )}

          {(bounty.status === "worker_selected" || bounty.status === "processing") && (
            <DSButton
              label="Submit Proof"
              icon="cloud-upload"
              fullWidth
              onPress={() => router.push(`/bounty/${id}/submit`)}
            />
          )}

          {(bounty.status === "pending" || bounty.status === "awaiting_quotes") && (
            <DSButton
              label="Submit Quote"
              icon="hand-right"
              variant="secondary"
              fullWidth
              onPress={() => router.push(`/bounty/${id}/submit`)}
            />
          )}
        </View>
      </View>
    </ScrollView>
  );
}
