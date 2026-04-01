import React, { useState } from "react";
import { View, ScrollView, Alert } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DSText, DSInput, DSButton, DSSection, DSCard, DSFeedbackBanner } from "../../src/components/ds";
import { BountyTypeToggle } from "../../src/components/bounty/BountyTypeToggle";
import { createQuery, fetchOracleHash } from "../../src/api/client";
import { useUserLocation } from "../../src/hooks/useUserLocation";
import type { CreateQueryRequest } from "../../src/api/types";

export default function CreateScreen() {
  const insets = useSafeAreaInsets();
  const userLocation = useUserLocation();
  const [type, setType] = useState<"photo" | "web">("photo");
  const [description, setDescription] = useState("");
  const [locationHint, setLocationHint] = useState("");
  const [sats, setSats] = useState("");
  const [ttl, setTtl] = useState("30");
  const [gpsDistance, setGpsDistance] = useState("5");
  const [targetUrl, setTargetUrl] = useState("");
  const [conditions, setConditions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setError(null);

    if (!description.trim()) {
      setError("Description is required");
      return;
    }

    setSubmitting(true);
    try {
      const body: CreateQueryRequest = {
        description: description.trim(),
        type,
        ttl_seconds: parseInt(ttl) * 60,
        bounty_amount_sats: sats ? parseInt(sats) : undefined,
        verification_requirements: type === "photo"
          ? ["nonce", "gps", "timestamp"]
          : ["tlsn"],
      };

      if (type === "photo") {
        if (locationHint.trim()) body.location_hint = locationHint.trim();
        if (userLocation) body.expected_gps = userLocation;
        if (gpsDistance) body.gps_max_distance_km = parseFloat(gpsDistance);
      }

      if (type === "web") {
        if (targetUrl.trim()) {
          body.tlsn_requirements = {
            target_url: targetUrl.trim(),
            conditions: conditions.trim()
              ? conditions.split("\n").filter(Boolean).map((c) => ({
                  type: "contains" as const,
                  expression: c.trim(),
                }))
              : undefined,
          };
        }
      }

      const result = await createQuery(body);
      setDescription("");
      setLocationHint("");
      setSats("");
      setTargetUrl("");
      setConditions("");
      router.push(`/bounty/${result.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create bounty");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 40 }}
    >
      <View className="px-4 mb-4">
        <DSText variant="heading" weight="bold">Create Bounty</DSText>
      </View>

      <View className="px-4 gap-4">
        <BountyTypeToggle type={type} onTypeChange={setType} />

        {error && <DSFeedbackBanner variant="error" message={error} />}

        <DSSection title="DETAILS">
          <DSCard className="gap-3">
            <DSInput
              label="Description"
              value={description}
              onChangeText={setDescription}
              placeholder={type === "photo" ? "Photo of the Shibuya crossing right now" : "Prove current BTC price from CoinGecko"}
              multiline
              numberOfLines={3}
            />

            {type === "photo" && (
              <>
                <DSInput
                  label="Location Hint"
                  value={locationHint}
                  onChangeText={setLocationHint}
                  placeholder="Shibuya, Tokyo"
                />
                <DSInput
                  label="GPS Max Distance (km)"
                  value={gpsDistance}
                  onChangeText={setGpsDistance}
                  placeholder="5"
                  keyboardType="numeric"
                />
              </>
            )}

            {type === "web" && (
              <>
                <DSInput
                  label="Target URL"
                  value={targetUrl}
                  onChangeText={setTargetUrl}
                  placeholder="https://api.coingecko.com/api/v3/..."
                  autoCapitalize="none"
                />
                <DSInput
                  label="Conditions (one per line)"
                  value={conditions}
                  onChangeText={setConditions}
                  placeholder="bitcoin"
                  multiline
                  numberOfLines={2}
                />
              </>
            )}
          </DSCard>
        </DSSection>

        <DSSection title="REWARD & TIMING">
          <DSCard className="gap-3">
            <DSInput
              label="Bounty (sats)"
              value={sats}
              onChangeText={setSats}
              placeholder="21"
              keyboardType="numeric"
            />
            <DSInput
              label="TTL (minutes)"
              value={ttl}
              onChangeText={setTtl}
              placeholder="30"
              keyboardType="numeric"
            />
          </DSCard>
        </DSSection>

        <DSButton
          label="Post Bounty"
          icon="flash"
          fullWidth
          loading={submitting}
          onPress={handleCreate}
        />
      </View>
    </ScrollView>
  );
}
