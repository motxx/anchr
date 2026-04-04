import React from "react";
import { ScrollView } from "react-native";
import { DSChip } from "../ds";
import { useFeedStore, type FeedFilter } from "../../store/feed";

const FILTERS: { key: FeedFilter; label: string; icon: string }[] = [
  { key: "nearby", label: "Nearby", icon: "location" },
  { key: "new", label: "New", icon: "time" },
  { key: "hot", label: "Hot", icon: "flame" },
  { key: "photo", label: "Photo", icon: "camera" },
  { key: "web", label: "Web", icon: "globe" },
];

export function FilterBar() {
  const { activeFilter, setFilter } = useFeedStore();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-2 px-4 py-2"
    >
      {FILTERS.map((f) => (
        <DSChip
          key={f.key}
          label={f.label}
          icon={f.icon as any}
          selected={activeFilter === f.key}
          onPress={() => setFilter(f.key)}
        />
      ))}
    </ScrollView>
  );
}
