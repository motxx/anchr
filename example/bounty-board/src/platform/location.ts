import { Platform } from "react-native";
import type { GpsCoord } from "../api/types";

export interface LocationProvider {
  requestPermission(): Promise<boolean>;
  getCurrentPosition(): Promise<GpsCoord>;
}

function createNativeProvider(): LocationProvider {
  return {
    async requestPermission() {
      const Location = await import("expo-location");
      const { status } = await Location.requestForegroundPermissionsAsync();
      return status === "granted";
    },
    async getCurrentPosition() {
      const Location = await import("expo-location");
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      return { lat: loc.coords.latitude, lon: loc.coords.longitude };
    },
  };
}

function createWebProvider(): LocationProvider {
  return {
    async requestPermission() {
      if (!("geolocation" in navigator)) return false;
      if (navigator.permissions) {
        try {
          const result = await navigator.permissions.query({ name: "geolocation" });
          return result.state !== "denied";
        } catch {
          return true;
        }
      }
      return true;
    },
    async getCurrentPosition() {
      return new Promise<GpsCoord>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
          (err) => reject(new Error(`Geolocation error: ${err.message}`)),
          { enableHighAccuracy: true, timeout: 15000 },
        );
      });
    },
  };
}

export function createLocationProvider(): LocationProvider {
  return Platform.OS === "web" ? createWebProvider() : createNativeProvider();
}

export const locationProvider = createLocationProvider();
