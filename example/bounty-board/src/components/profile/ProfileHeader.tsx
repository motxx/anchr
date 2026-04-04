import React, { useState } from "react";
import { View, Pressable } from "react-native";
import { DSAvatar, DSText, DSBadge } from "../ds";
import { truncateNpub } from "../../utils/format";
import { clipboardProvider } from "../../platform/clipboard";
import { Ionicons } from "@expo/vector-icons";

interface ProfileHeaderProps {
  npub: string;
  publicKey: string;
  stats?: {
    posted: number;
    fulfilled: number;
    approvalRate: number;
    totalEarned: number;
  };
}

function getReputationBadge(fulfilled: number): { label: string; variant: "default" | "info" | "success" | "warning" } {
  if (fulfilled >= 100) return { label: "Legend", variant: "warning" };
  if (fulfilled >= 25) return { label: "Verified", variant: "success" };
  if (fulfilled >= 5) return { label: "Trusted", variant: "info" };
  return { label: "New", variant: "default" };
}

export function ProfileHeader({ npub, publicKey, stats }: ProfileHeaderProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await clipboardProvider.copyText(npub);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const reputation = getReputationBadge(stats?.fulfilled ?? 0);

  return (
    <View className="items-center py-6 px-4">
      <DSAvatar pubkey={publicKey} size="xl" />

      <Pressable onPress={handleCopy} className="flex-row items-center gap-1.5 mt-3">
        <DSText variant="body" weight="medium" color="text-muted-foreground">
          {truncateNpub(npub, 10)}
        </DSText>
        <Ionicons
          name={copied ? "checkmark" : "copy-outline"}
          size={14}
          color={copied ? "#10b981" : "#a1a1aa"}
        />
      </Pressable>

      <View className="mt-2">
        <DSBadge label={reputation.label} variant={reputation.variant} />
      </View>

      {stats && (
        <View className="flex-row gap-6 mt-4">
          <View className="items-center">
            <DSText variant="subheading" weight="bold">{stats.posted}</DSText>
            <DSText variant="caption" muted>Posted</DSText>
          </View>
          <View className="items-center">
            <DSText variant="subheading" weight="bold">{stats.fulfilled}</DSText>
            <DSText variant="caption" muted>Fulfilled</DSText>
          </View>
          <View className="items-center">
            <DSText variant="subheading" weight="bold">{Math.round(stats.approvalRate * 100)}%</DSText>
            <DSText variant="caption" muted>Approval</DSText>
          </View>
          <View className="items-center">
            <DSText variant="subheading" weight="bold">{stats.totalEarned}</DSText>
            <DSText variant="caption" muted>Earned</DSText>
          </View>
        </View>
      )}
    </View>
  );
}
