import React, { useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  Alert,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { useWalletStore, type WalletTransaction } from "../../src/store/wallet";

function formatTime(ts: number): string {
  const d = new Date(ts);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${month}/${day} ${hours}:${minutes}`;
}

function TransactionRow({ tx }: { tx: WalletTransaction }) {
  const handleCopyToken = useCallback(async () => {
    await Clipboard.setStringAsync(tx.cashuToken);
    Alert.alert("Copied", "Cashu token copied to clipboard. Paste into any Cashu wallet to redeem.");
  }, [tx.cashuToken]);

  return (
    <Pressable
      onPress={handleCopyToken}
      className="bg-white rounded-xl px-4 py-3.5 flex-row items-center"
    >
      <View className="w-10 h-10 rounded-full bg-emerald-50 items-center justify-center mr-3">
        <Ionicons name="arrow-down" size={18} color="#10b981" />
      </View>
      <View className="flex-1 mr-3">
        <Text className="text-sm font-medium text-gray-900" numberOfLines={1}>
          {tx.description}
        </Text>
        <Text className="text-xs text-gray-400 mt-0.5">
          {formatTime(tx.timestamp)}
        </Text>
      </View>
      <View className="items-end">
        <Text className="text-sm font-bold text-emerald-600">
          +{tx.amountSats} sats
        </Text>
        <View className="flex-row items-center gap-1 mt-0.5">
          <Ionicons name="copy-outline" size={10} color="#9ca3af" />
          <Text className="text-[10px] text-gray-400">tap to copy</Text>
        </View>
      </View>
    </Pressable>
  );
}

export default function WalletScreen() {
  const { balance, transactions } = useWalletStore();

  return (
    <View className="flex-1 bg-stone-50">
      {/* Balance card */}
      <View className="px-4 pt-14 pb-5 bg-stone-50">
        <View className="bg-gray-900 rounded-2xl px-6 py-6">
          <Text className="text-xs text-gray-400 uppercase tracking-widest mb-1">
            Balance
          </Text>
          <View className="flex-row items-baseline gap-2">
            <Text className="text-4xl font-black text-white">
              {balance.toLocaleString()}
            </Text>
            <Text className="text-lg font-semibold text-gray-400">sats</Text>
          </View>
          <View className="flex-row items-center gap-1.5 mt-3">
            <Ionicons name="flash" size={12} color="#f59e0b" />
            <Text className="text-xs text-gray-500">
              Cashu ecash {"\u2022"} earned from queries
            </Text>
          </View>
        </View>
      </View>

      {/* Transactions */}
      <View className="px-4 mb-2">
        <Text className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
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
            <View className="w-14 h-14 rounded-full bg-gray-100 items-center justify-center mb-3">
              <Ionicons name="wallet-outline" size={24} color="#9ca3af" />
            </View>
            <Text className="text-sm font-medium text-gray-500">
              No earnings yet
            </Text>
            <Text className="text-xs text-gray-400 mt-1 text-center">
              Complete queries with bounties{"\n"}to earn sats
            </Text>
          </View>
        }
      />
    </View>
  );
}
