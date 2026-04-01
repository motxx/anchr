import React from "react";
import { View } from "react-native";
import { DSCard, DSText, DSFeedbackBanner } from "../ds";
import { Ionicons } from "@expo/vector-icons";
import type { VerificationDetail } from "../../api/types";

interface VerificationResultsProps {
  verification: VerificationDetail;
}

export function VerificationResults({ verification }: VerificationResultsProps) {
  return (
    <View className="gap-3">
      <DSFeedbackBanner
        variant={verification.passed ? "success" : "error"}
        message={verification.passed ? "All checks passed" : "Verification failed"}
      />

      {verification.checks.length > 0 && (
        <DSCard>
          <DSText variant="label" weight="semibold" muted className="mb-2">
            CHECKS PASSED
          </DSText>
          {verification.checks.map((check, i) => (
            <View key={i} className="flex-row items-center gap-2 py-1">
              <Ionicons name="checkmark-circle" size={16} color="#10b981" />
              <DSText variant="body">{check}</DSText>
            </View>
          ))}
        </DSCard>
      )}

      {verification.failures.length > 0 && (
        <DSCard>
          <DSText variant="label" weight="semibold" muted className="mb-2">
            FAILURES
          </DSText>
          {verification.failures.map((fail, i) => (
            <View key={i} className="flex-row items-center gap-2 py-1">
              <Ionicons name="close-circle" size={16} color="#ef4444" />
              <DSText variant="body" color="text-red-400">{fail}</DSText>
            </View>
          ))}
        </DSCard>
      )}

      {verification.tlsn_verified && (
        <DSCard>
          <DSText variant="label" weight="semibold" muted className="mb-2">
            TLSN PROOF
          </DSText>
          <View className="gap-1">
            <DSText variant="caption" muted>
              Server: {verification.tlsn_verified.server_name}
            </DSText>
            <DSText variant="mono" numberOfLines={5}>
              {verification.tlsn_verified.revealed_body}
            </DSText>
          </View>
        </DSCard>
      )}
    </View>
  );
}
