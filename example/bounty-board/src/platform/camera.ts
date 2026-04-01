import { Platform } from "react-native";

export interface CapturedPhoto {
  uri: string;
  filename: string;
  mimeType: string;
}

export interface CameraProvider {
  requestPermission(): Promise<boolean>;
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
      if (typeof navigator !== "undefined" && navigator.mediaDevices) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          stream.getTracks().forEach((t) => t.stop());
          return true;
        } catch {
          return false;
        }
      }
      return true;
    },
  };
}

export function createCameraProvider(): CameraProvider {
  return Platform.OS === "web" ? createWebProvider() : createNativeProvider();
}

export function fileToPhoto(file: File): CapturedPhoto {
  return {
    uri: URL.createObjectURL(file),
    filename: file.name,
    mimeType: file.type || "image/jpeg",
  };
}

export const cameraProvider = createCameraProvider();
