import React from "react";
import { View } from "react-native";
import {
  DSAvatar,
  DSButton,
  DSCard,
  DSSatsAmount,
  DSText,
} from "../ds/index.ts";
import type { OfferInfo } from "../../api/types.ts";
import { truncateNpub } from "../../utils/format.ts";
import { npubEncode } from "../../nostr/nip19.ts";

interface OfferListProps {
  offers: OfferInfo[];
  onSelectWorker: (workerPubkey: string) => void;
  selecting?: boolean;
}

export function OfferList(
  { offers, onSelectWorker, selecting }: OfferListProps,
) {
  if (offers.length === 0) {
    return (
      <DSCard>
        <DSText variant="body" muted className="text-center py-4">
          No offers yet. Workers will submit offers soon.
        </DSText>
      </DSCard>
    );
  }

  return (
    <View className="gap-2">
      {offers.map((offer) => {
        const npub = npubEncode(offer.worker_pubkey);
        return (
          <DSCard key={offer.worker_pubkey}>
            <View className="flex-row items-center gap-3">
              <DSAvatar pubkey={offer.worker_pubkey} size="sm" />
              <View className="flex-1">
                <DSText variant="body" weight="medium">
                  {truncateNpub(npub)}
                </DSText>
                {offer.amount_sats && (
                  <DSSatsAmount amount={offer.amount_sats} size="sm" />
                )}
              </View>
              <DSButton
                label="Select"
                size="sm"
                onPress={() => onSelectWorker(offer.worker_pubkey)}
                loading={selecting}
              />
            </View>
          </DSCard>
        );
      })}
    </View>
  );
}
