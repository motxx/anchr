/**
 * Platform-abstracted camera/photo capture.
 *
 * Native: expo-camera CameraView
 * Web: <input type="file" accept="image/*" capture>
 */

import { Platform } from "react-native";

export interface CapturedPhoto {
  uri: string;
  filename: string;
  mimeType: string;
}

export interface CameraProvider {
  /** Request camera permission. Returns true if granted. */
  requestPermission(): Promise<boolean>;
  /** Whether this platform supports a live camera viewfinder (native only). */
  hasLiveViewfinder: boolean;
}

function createNativeProvider(): CameraProvider {
  return {
    hasLiveViewfinder: true,
    async requestPermission() {
      const { Camera } = await import("expo-camera");
      const { status } = await Camera.requestCameraPermissionsAsync();
      return status === "granted";
    },
  };
}

function createWebProvider(): CameraProvider {
  return {
    hasLiveViewfinder: false,
    async requestPermission() {
      // On web, permission is handled by the browser when <input capture> is used.
      // We can check if mediaDevices is available.
      if (typeof navigator !== "undefined" && navigator.mediaDevices) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          stream.getTracks().forEach((t) => t.stop());
          return true;
        } catch {
          return false;
        }
      }
      // Even without mediaDevices, <input type="file" capture> works on mobile browsers
      return true;
    },
  };
}

export function createCameraProvider(): CameraProvider {
  return Platform.OS === "web" ? createWebProvider() : createNativeProvider();
}

/**
 * Convert a web File object to a CapturedPhoto with an object URL.
 * Call URL.revokeObjectURL(photo.uri) when done.
 */
export function fileToPhoto(file: File): CapturedPhoto {
  return {
    uri: URL.createObjectURL(file),
    filename: file.name,
    mimeType: file.type || "image/jpeg",
  };
}

export const cameraProvider = createCameraProvider();
