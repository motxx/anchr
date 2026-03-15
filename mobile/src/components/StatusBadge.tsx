import React from "react";
import { View, Text } from "react-native";
import type { QueryStatus } from "../api/types";

const STATUS_CONFIG: Record<QueryStatus, { label: string; bg: string; text: string }> = {
  pending: { label: "Pending", bg: "bg-blue-50", text: "text-blue-700" },
  awaiting_quotes: { label: "Awaiting Quotes", bg: "bg-purple-50", text: "text-purple-700" },
  worker_selected: { label: "Worker Selected", bg: "bg-indigo-50", text: "text-indigo-700" },
  processing: { label: "Processing", bg: "bg-amber-50", text: "text-amber-700" },
  verifying: { label: "Verifying", bg: "bg-cyan-50", text: "text-cyan-700" },
  submitted: { label: "Submitted", bg: "bg-blue-50", text: "text-blue-700" },
  approved: { label: "Approved", bg: "bg-emerald-50", text: "text-emerald-700" },
  rejected: { label: "Rejected", bg: "bg-red-50", text: "text-red-700" },
  expired: { label: "Expired", bg: "bg-gray-100", text: "text-gray-500" },
};

export function StatusBadge({ status }: { status: QueryStatus }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <View className={`${config.bg} rounded-full px-2.5 py-0.5`}>
      <Text className={`${config.text} text-xs font-semibold`}>
        {config.label}
      </Text>
    </View>
  );
}
