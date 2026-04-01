import React, { useState } from "react";
import { View } from "react-native";
import { DSInput, DSButton, DSSection, DSCard } from "../ds";
import { useSettingsStore } from "../../store/settings";

export function SettingsForm() {
  const { serverUrl, relayUrls, mintUrl, setServerUrl, setRelayUrls, setMintUrl } = useSettingsStore();
  const [server, setServer] = useState(serverUrl);
  const [relays, setRelays] = useState(relayUrls.join("\n"));
  const [mint, setMint] = useState(mintUrl);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setServerUrl(server);
    setRelayUrls(relays.split("\n").map((u) => u.trim()).filter(Boolean));
    setMintUrl(mint);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <View className="gap-4 px-4">
      <DSSection title="SERVER">
        <DSCard>
          <DSInput
            label="Anchr Server URL"
            value={server}
            onChangeText={setServer}
            placeholder="http://localhost:3000"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </DSCard>
      </DSSection>

      <DSSection title="NOSTR RELAYS">
        <DSCard>
          <DSInput
            label="Relay URLs (one per line)"
            value={relays}
            onChangeText={setRelays}
            placeholder="wss://relay.damus.io"
            multiline
            numberOfLines={3}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </DSCard>
      </DSSection>

      <DSSection title="CASHU MINT">
        <DSCard>
          <DSInput
            label="Mint URL"
            value={mint}
            onChangeText={setMint}
            placeholder="https://mint.minibits.cash/Bitcoin"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </DSCard>
      </DSSection>

      <DSButton
        label={saved ? "Saved!" : "Save Settings"}
        icon={saved ? "checkmark" : undefined}
        variant={saved ? "secondary" : "primary"}
        fullWidth
        onPress={handleSave}
      />
    </View>
  );
}
