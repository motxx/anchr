import React from "react";
import { View } from "react-native";
import { DSText, DSCard } from "./ds";

interface Props {
  nonce: string;
  rule: string;
}

export function ChallengeNonceDisplay({ nonce, rule }: Props) {
  return (
    <DSCard className="bg-amber-50 border-amber-300 px-5 py-5">
      <DSText variant="label" weight="semibold" color="text-amber-700" className="mb-3">
        Challenge Nonce
      </DSText>
      <DSText variant="mono" weight="black" color="text-amber-600" className="text-5xl tracking-[0.4em] leading-none mb-4">
        {nonce}
      </DSText>
      <DSText variant="body" color="text-gray-700" className="leading-relaxed">
        {rule}
      </DSText>
    </DSCard>
  );
}
