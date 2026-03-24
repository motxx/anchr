import React from "react";
import { View } from "react-native";
import { DSText, DSCard } from "./ds";

interface Props {
  nonce: string;
  rule: string;
}

export function ChallengeNonceDisplay({ nonce, rule }: Props) {
  return (
    <DSCard className="bg-amber-950/30 border-amber-800 px-5 py-5">
      <DSText variant="label" weight="semibold" color="text-amber-500" className="mb-3">
        Challenge Nonce
      </DSText>
      <DSText variant="mono" weight="black" color="text-amber-400" className="text-5xl tracking-[0.4em] leading-none mb-4">
        {nonce}
      </DSText>
      <DSText variant="body" color="text-muted-foreground" className="leading-relaxed">
        {rule}
      </DSText>
    </DSCard>
  );
}
