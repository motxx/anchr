import { create } from "zustand";

export type FeedFilter = "nearby" | "new" | "hot" | "photo" | "web";

interface FeedState {
  activeFilter: FeedFilter;
  setFilter: (filter: FeedFilter) => void;
}

export const useFeedStore = create<FeedState>((set) => ({
  activeFilter: "new",
  setFilter: (filter) => set({ activeFilter: filter }),
}));
