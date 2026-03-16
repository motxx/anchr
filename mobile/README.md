# Anchr Worker Mobile App

Expo (React Native) app for Workers — browse queries, take photos, earn sats.

## Prerequisites

- **Node.js** >= 20 (Metro bundler requires Node.js, not Bun)
- **Watchman** (file watcher for Metro)
- **Bun** (package manager)
- iOS Simulator (Xcode) or Android Emulator, or Expo Go on a physical device

### Install prerequisites (macOS with Nix)

```sh
nix profile install nixpkgs#nodejs_22 nixpkgs#watchman
```

### Install prerequisites (macOS with Homebrew)

```sh
brew install node watchman
```

## Setup

```sh
cd mobile
bun install
```

## Run

```sh
# iOS Simulator
bun run ios

# Android Emulator
bun run android

# Dev server only (scan QR with Expo Go)
bun run start
```

## Project Structure

```
app/                    # expo-router screens
  (tabs)/
    index.tsx           # Query list (home)
    map.tsx             # Map view (Phase 2)
    wallet.tsx          # Cashu wallet (Phase 4)
    settings.tsx        # Server URL, API key
  query/
    [id].tsx            # Query detail + camera + submit
src/
  api/                  # HTTP API client
  components/           # Reusable UI components
  hooks/                # React Query hooks
  store/                # Zustand stores
  utils/                # Distance, time helpers
```
