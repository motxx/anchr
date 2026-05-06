import React, { useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  Alert,
} from "react-native";
import { clipboardProvider } from "../../src/platform/clipboard";
import { Ionicons } from "@expo/vector-icons";
import { formatShortTime } from "../../src/utils/time";
import { useWalletStore, type WalletTransaction } from "../../src/store/wallet";

const TransactionRow = React.memo(function TransactionRow({ tx }: { tx: WalletTransaction }) {
  const handleCopyToken = useCallback(async () => {
    await clipboardProvider.copyText(tx.cashuToken);
    Alert.alert("Copied", "Cashu token copied to clipboard. Paste into any Cashu wallet to redeem.");
  }, [tx.cashuToken]);

  return (
    <Pressable
      onPress={handleCopyToken}
      className="bg-surface rounded-2xl px-4 py-4 flex-row items-center active:opacity-80"
    >
      <View className="w-12 h-12 rounded-full bg-emerald-950 items-center justify-center mr-3.5">
        <Ionicons name="arrow-down" size={20} color="#10b981" />
      </View>
      <View className="flex-1 mr-3">
        <Text className="text-[15px] font-semibold text-foreground" numberOfLines={1}>
          {tx.description}
        </Text>
        <View className="flex-row items-center gap-2 mt-1">
          <Text className="text-[11px] text-muted-foreground">
            {formatShortTime(tx.timestamp)}
          </Text>
          <View className="flex-row items-center gap-1 bg-surface-raised rounded-full px-2 py-0.5">
            <Ionicons name="copy-outline" size={9} color="#52525b" />
            <Text className="text-[10px] text-subtle">copy token</Text>
          </View>
        </View>
      </View>
      <View className="bg-emerald-950 rounded-full px-3.5 py-2">
        <Text className="text-[15px] font-bold text-primary">
          +{tx.amountSats}
        </Text>
      </View>
    </Pressable>
  );
});

export default function WalletScreen() {
  const { balance, transactions } = useWalletStore();

  return (
    <View className="flex-1 bg-background">
      {/* Header + Balance card */}
      <View className="px-5 pt-16 pb-2">
        <Text className="text-2xl font-black text-foreground tracking-tight mb-5">
          Wallet
        </Text>

        <View className="bg-surface rounded-3xl px-6 py-7 border border-border">
          {/* Balance */}
          <View className="items-center">
            <Text className="text-xs text-muted-foreground uppercase tracking-widest mb-2 font-bold">
              Total Balance
            </Text>
            <View className="flex-row items-baseline gap-2">
              <Text className="text-5xl font-black text-foreground">
                {balance.toLocaleString()}
              </Text>
              <Text className="text-lg font-bold text-muted-foreground">sats</Text>
            </View>
          </View>

          {/* Divider */}
          <View className="h-px bg-border my-5" />

          {/* Info row */}
          <View className="flex-row items-center justify-center gap-2">
            <View className="w-7 h-7 rounded-full bg-amber-950 items-center justify-center">
              <Ionicons name="flash" size={14} color="#f59e0b" />
            </View>
            <Text className="text-[13px] text-muted-foreground">
              Cashu ecash — earned from queries
            </Text>
          </View>
        </View>
      </View>

      {/* Transactions header */}
      <View className="px-5 mt-5 mb-3 flex-row items-center gap-2.5">
        <View className="w-7 h-7 rounded-full bg-surface-raised items-center justify-center">
          <Ionicons name="list-outline" size={13} color="#a1a1aa" />
        </View>
        <Text className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex-1">
          Earnings
        </Text>
        {transactions.length > 0 && (
          <View className="bg-surface-raised rounded-full px-2.5 py-1 min-w-[24px] items-center">
            <Text className="text-[10px] font-bold text-muted-foreground">{transactions.length}</Text>
          </View>
        )}
      </View>

      <FlatList
        data={transactions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <TransactionRow tx={item} />}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 24 }}
        ListEmptyComponent={
          <View className="items-center justify-center py-20">
            <View className="w-16 h-16 rounded-full bg-surface items-center justify-center mb-4">
              <Ionicons name="wallet-outline" size={28} color="#52525b" />
            </View>
            <Text className="text-[15px] font-semibold text-foreground">
              No earnings yet
            </Text>
            <Text className="text-[13px] text-muted-foreground mt-1 text-center">
              Complete queries with bounties{"\n"}to earn sats
            </Text>
          </View>
        }
      />
    </View>
  );
}
