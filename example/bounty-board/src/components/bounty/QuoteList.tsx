import React from "react";
import { View } from "react-native";
import { DSCard, DSText, DSButton, DSAvatar, DSSatsAmount } from "../ds";
import type { QuoteInfo } from "../../api/types";
import { truncateNpub } from "../../utils/format";
import { npubEncode } from "../../nostr/nip19";

interface QuoteListProps {
  quotes: QuoteInfo[];
  onSelectWorker: (workerPubkey: string) => void;
  selecting?: boolean;
}

export function QuoteList({ quotes, onSelectWorker, selecting }: QuoteListProps) {
  if (quotes.length === 0) {
    return (
      <DSCard>
        <DSText variant="body" muted className="text-center py-4">
          No quotes yet. Workers will submit quotes soon.
        </DSText>
      </DSCard>
    );
  }

  return (
    <View className="gap-2">
      {quotes.map((quote) => {
        const npub = npubEncode(quote.worker_pubkey);
        return (
          <DSCard key={quote.worker_pubkey}>
            <View className="flex-row items-center gap-3">
              <DSAvatar pubkey={quote.worker_pubkey} size="sm" />
              <View className="flex-1">
                <DSText variant="body" weight="medium">
                  {truncateNpub(npub)}
                </DSText>
                {quote.amount_sats && (
                  <DSSatsAmount amount={quote.amount_sats} size="sm" />
                )}
              </View>
              <DSButton
                label="Select"
                size="sm"
                onPress={() => onSelectWorker(quote.worker_pubkey)}
                loading={selecting}
              />
            </View>
          </DSCard>
        );
      })}
    </View>
  );
}
