import React from "react";
import { View } from "react-native";
import { DSText } from "../ds";
import { Ionicons } from "@expo/vector-icons";
import type { QueryStatus } from "../../api/types";

const STEPS: { key: QueryStatus; label: string }[] = [
  { key: "pending", label: "Created" },
  { key: "awaiting_quotes", label: "Quoted" },
  { key: "worker_selected", label: "Selected" },
  { key: "submitted", label: "Submitted" },
  { key: "approved", label: "Verified" },
];

const STATUS_ORDER: Record<string, number> = {};
STEPS.forEach((s, i) => { STATUS_ORDER[s.key] = i; });
STATUS_ORDER["processing"] = 2;
STATUS_ORDER["verifying"] = 3;
STATUS_ORDER["rejected"] = 4;
STATUS_ORDER["expired"] = -1;

export function StatusTimeline({ status }: { status: QueryStatus }) {
  const currentIndex = STATUS_ORDER[status] ?? 0;
  const isRejected = status === "rejected";
  const isExpired = status === "expired";

  return (
    <View className="flex-row items-center justify-between px-2">
      {STEPS.map((step, i) => {
        const isDone = i <= currentIndex && !isExpired;
        const isCurrent = i === currentIndex && !isExpired;
        const isFailed = i === currentIndex && isRejected;

        return (
          <React.Fragment key={step.key}>
            {i > 0 && (
              <View
                className={`flex-1 h-0.5 mx-1 ${
                  isDone && !isCurrent ? "bg-primary" : "bg-surface-raised"
                }`}
              />
            )}
            <View className="items-center">
              <View
                className={`w-7 h-7 rounded-full items-center justify-center ${
                  isFailed
                    ? "bg-destructive"
                    : isDone
                    ? "bg-primary"
                    : "bg-surface-raised"
                }`}
              >
                {isFailed ? (
                  <Ionicons name="close" size={14} color="#fff" />
                ) : isDone ? (
                  <Ionicons name="checkmark" size={14} color="#fff" />
                ) : (
                  <View className="w-2 h-2 rounded-full bg-subtle" />
                )}
              </View>
              <DSText
                variant="caption"
                color={isCurrent ? "text-foreground" : "text-muted-foreground"}
                className="mt-1"
              >
                {step.label}
              </DSText>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}
