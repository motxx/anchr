/**
 * Platform-abstracted clipboard.
 *
 * Native: expo-clipboard
 * Web: navigator.clipboard
 */

import { Platform } from "react-native";

export interface ClipboardProvider {
  copyText(text: string): Promise<void>;
}

function createNativeProvider(): ClipboardProvider {
  return {
    async copyText(text) {
      const Clipboard = await import("expo-clipboard");
      await Clipboard.setStringAsync(text);
    },
  };
}

function createWebProvider(): ClipboardProvider {
  return {
    async copyText(text) {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for older browsers / non-HTTPS
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
    },
  };
}

export function createClipboardProvider(): ClipboardProvider {
  return Platform.OS === "web" ? createWebProvider() : createNativeProvider();
}

export const clipboardProvider = createClipboardProvider();
