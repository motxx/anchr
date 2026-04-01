import { Platform } from "react-native";

export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
}

export interface FilePickerProvider {
  pickFile(accept?: string[]): Promise<PickedFile | null>;
}

function createNativeProvider(): FilePickerProvider {
  return {
    async pickFile(accept = ["image/*", "application/zip"]) {
      const DocumentPicker = await import("expo-document-picker");
      const result = await DocumentPicker.getDocumentAsync({
        type: accept,
        copyToCacheDirectory: true,
      });
      if (result.canceled || result.assets.length === 0) return null;
      const asset = result.assets[0]!;
      return {
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? "image/jpeg",
      };
    },
  };
}

function createWebProvider(): FilePickerProvider {
  return {
    async pickFile(accept = ["image/*", "application/zip"]) {
      return new Promise<PickedFile | null>((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = accept.join(",");
        input.style.display = "none";
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          if (!file) {
            resolve(null);
            return;
          }
          resolve({
            uri: URL.createObjectURL(file),
            name: file.name,
            mimeType: file.type || "application/octet-stream",
          });
          document.body.removeChild(input);
        });
        input.addEventListener("cancel", () => {
          resolve(null);
          document.body.removeChild(input);
        });
        document.body.appendChild(input);
        input.click();
      });
    },
  };
}

export function createFilePickerProvider(): FilePickerProvider {
  return Platform.OS === "web" ? createWebProvider() : createNativeProvider();
}

export const filePickerProvider = createFilePickerProvider();
