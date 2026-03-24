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
      className="bg-surface rounded-xl px-4 py-3.5 flex-row items-center"
    >
      <View className="w-10 h-10 rounded-full bg-emerald-950 items-center justify-center mr-3">
        <Ionicons name="arrow-down" size={18} color="#10b981" />
      </View>
      <View className="flex-1 mr-3">
        <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
          {tx.description}
        </Text>
        <Text className="text-xs text-muted-foreground mt-0.5">
          {formatShortTime(tx.timestamp)}
        </Text>
      </View>
      <View className="items-end">
        <Text className="text-sm font-bold text-primary">
          +{tx.amountSats} sats
        </Text>
        <View className="flex-row items-center gap-1 mt-0.5">
          <Ionicons name="copy-outline" size={10} color="#52525b" />
          <Text className="text-[10px] text-muted-foreground">tap to copy</Text>
        </View>
      </View>
    </Pressable>
  );
});

export default function WalletScreen() {
  const { balance, transactions } = useWalletStore();

  return (
    <View className="flex-1 bg-background">
      {/* Balance card */}
      <View className="px-4 pt-14 pb-5 bg-background">
        <View className="bg-surface rounded-2xl px-6 py-6">
          <Text className="text-xs text-muted-foreground uppercase tracking-widest mb-1">
            Balance
          </Text>
          <View className="flex-row items-baseline gap-2">
            <Text className="text-4xl font-black text-foreground">
              {balance.toLocaleString()}
            </Text>
            <Text className="text-lg font-semibold text-muted-foreground">sats</Text>
          </View>
          <View className="flex-row items-center gap-1.5 mt-3">
            <Ionicons name="flash" size={12} color="#f59e0b" />
            <Text className="text-xs text-muted-foreground">
              Cashu ecash {"\u2022"} earned from queries
            </Text>
          </View>
        </View>
      </View>

      {/* Transactions */}
      <View className="px-4 mb-2">
        <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
          Earnings
        </Text>
      </View>

      <FlatList
        data={transactions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <TransactionRow tx={item} />}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 24 }}
        ListEmptyComponent={
          <View className="items-center justify-center py-16">
            <View className="w-14 h-14 rounded-full bg-surface-raised items-center justify-center mb-3">
              <Ionicons name="wallet-outline" size={24} color="#52525b" />
            </View>
            <Text className="text-sm font-medium text-muted-foreground">
              No earnings yet
            </Text>
            <Text className="text-xs text-muted-foreground mt-1 text-center">
              Complete queries with bounties{"\n"}to earn sats
            </Text>
          </View>
        }
      />
    </View>
  );
}
