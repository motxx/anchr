import React, { useState } from "react";
import { View, ScrollView, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DSText, DSButton, DSInput, DSSection, DSCard, DSFeedbackBanner } from "../../src/components/ds";
import { BalanceCard } from "../../src/components/wallet/BalanceCard";
import { TransactionList } from "../../src/components/wallet/TransactionList";
import { useWallet } from "../../src/hooks/useWallet";

export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const { balance, transactions, fundFromToken } = useWallet();
  const [tokenInput, setTokenInput] = useState("");
  const [funding, setFunding] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const handleFund = async () => {
    if (!tokenInput.trim()) return;

    setFunding(true);
    setFeedback(null);
    try {
      const amount = await fundFromToken(tokenInput.trim());
      setFeedback({ type: "success", message: `Added ${amount} sats to wallet` });
      setTokenInput("");
    } catch (e) {
      setFeedback({ type: "error", message: e instanceof Error ? e.message : "Fund failed" });
    } finally {
      setFunding(false);
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 40 }}
    >
      <View className="px-4 mb-4">
        <DSText variant="heading" weight="bold">Wallet</DSText>
      </View>

      <BalanceCard balance={balance} />

      <View className="px-4 mt-4 gap-4">
        <DSSection title="FUND WALLET">
          <DSCard className="gap-3">
            {feedback && (
              <DSFeedbackBanner variant={feedback.type} message={feedback.message} />
            )}
            <DSInput
              label="Cashu Token"
              value={tokenInput}
              onChangeText={setTokenInput}
              placeholder="cashuA..."
              autoCapitalize="none"
              autoCorrect={false}
              multiline
            />
            <DSButton
              label="Add Funds"
              icon="arrow-down-circle"
              fullWidth
              loading={funding}
              onPress={handleFund}
            />
          </DSCard>
        </DSSection>

        <DSSection title="TRANSACTIONS">
          <TransactionList transactions={transactions} />
        </DSSection>
      </View>
    </ScrollView>
  );
}
