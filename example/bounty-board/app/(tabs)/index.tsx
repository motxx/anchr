import React from "react";
import { View, FlatList, RefreshControl, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DSText, DSCard, DSSatsAmount, DSEmptyState } from "../../src/components/ds";
import { FlightCard } from "../../src/components/claim/ClaimCard";
import { useAutoClaims } from "../../src/hooks/useAutoClaims";
import { Ionicons } from "@expo/vector-icons";
import type { FlightClaim } from "../../src/hooks/useAutoClaims";

export default function ClaimsScreen() {
  const insets = useSafeAreaInsets();
  const {
    monitoring,
    claimed,
    totalRecoveredSats,
    totalRecoveredJpy,
    claimCount,
    isLoading,
    refetch,
  } = useAutoClaims();

  // Combine into sections for FlatList
  type ListItem =
    | { type: "header" }
    | { type: "section"; title: string; count: number }
    | { type: "flight"; claim: FlightClaim };

  const listData: ListItem[] = [
    { type: "header" },
  ];

  if (monitoring.length > 0) {
    listData.push({ type: "section", title: "監視中のフライト", count: monitoring.length });
    for (const c of monitoring) {
      listData.push({ type: "flight", claim: c });
    }
  }

  if (claimed.length > 0) {
    listData.push({ type: "section", title: "回収済み", count: claimed.length });
    for (const c of claimed) {
      listData.push({ type: "flight", claim: c });
    }
  }

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {isLoading && monitoring.length === 0 && claimed.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#10b981" />
        </View>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item, index) => {
            if (item.type === "flight") return item.claim.id;
            return `${item.type}-${index}`;
          }}
          renderItem={({ item }) => {
            if (item.type === "header") {
              return (
                <View className="px-4 pt-4 pb-2">
                  {/* App title */}
                  <View className="flex-row items-center gap-2 mb-4">
                    <Ionicons name="airplane" size={20} color="#10b981" />
                    <DSText variant="heading" weight="bold">FlightBack</DSText>
                  </View>

                  {/* Recovery card */}
                  <DSCard className="items-center py-6 mb-1">
                    {totalRecoveredSats > 0 ? (
                      <>
                        <DSText variant="caption" muted className="mb-1">
                          取り戻し済み
                        </DSText>
                        <DSSatsAmount amount={totalRecoveredSats} size="xl" />
                        <DSText variant="caption" muted className="mt-1">
                          {claimCount}件のフライト遅延補償
                        </DSText>
                      </>
                    ) : (
                      <>
                        <View className="w-14 h-14 rounded-full bg-surface-raised items-center justify-center mb-3">
                          <Ionicons name="shield-checkmark" size={28} color="#10b981" />
                        </View>
                        <DSText variant="body" weight="medium" className="text-center">
                          フライト遅延を自動監視中
                        </DSText>
                        <DSText variant="caption" muted className="mt-1 text-center">
                          遅延が発生すると自動で補償を請求します
                        </DSText>
                      </>
                    )}
                  </DSCard>
                </View>
              );
            }

            if (item.type === "section") {
              return (
                <View className="px-4 pt-4 pb-1.5">
                  <View className="flex-row items-center gap-2">
                    <DSText variant="caption" weight="bold" muted>
                      {item.title}
                    </DSText>
                    <View className="bg-surface-raised rounded-full px-1.5 py-0.5">
                      <DSText variant="caption" muted style={{ fontSize: 10 }}>
                        {item.count}
                      </DSText>
                    </View>
                  </View>
                </View>
              );
            }

            if (item.type === "flight") {
              return (
                <FlightCard
                  claim={item.claim}
                  onPress={() => router.push(`/bounty/${item.claim.queryId}`)}
                />
              );
            }

            return null;
          }}
          ListEmptyComponent={
            <View className="px-4 pt-4">
              <DSEmptyState
                icon="airplane-outline"
                title="フライトがありません"
                subtitle="フライト遅延保険に加入すると、ここに監視中のフライトが表示されます。遅延が発生したら自動で補償を請求します。"
              />
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={() => refetch()}
              tintColor="#10b981"
            />
          }
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      )}
    </View>
  );
}
