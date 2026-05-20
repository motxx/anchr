import { describe, test, expect, mock } from "bun:test";
import type { FilePickerProvider, PickedFile } from "../file-picker";

function createMockFilePickerProvider(overrides?: Partial<FilePickerProvider>): FilePickerProvider {
  return {
    pickFile: mock(() => Promise.resolve({
      uri: "file:///cache/photo.jpg",
      name: "photo.jpg",
      mimeType: "image/jpeg",
    } as PickedFile)),
    ...overrides,
  };
}

describe("FilePickerProvider contract", () => {
  test("pickFile returns a PickedFile", async () => {
    const provider = createMockFilePickerProvider();
    const file = await provider.pickFile();
    expect(file).not.toBeNull();
    expect(file!.name).toBe("photo.jpg");
    expect(file!.mimeType).toBe("image/jpeg");
    expect(file!.uri).toStartWith("file://");
  });

  test("pickFile returns null on cancel", async () => {
    const provider = createMockFilePickerProvider({
      pickFile: mock(() => Promise.resolve(null)),
    });
    const file = await provider.pickFile();
    expect(file).toBeNull();
  });

  test("pickFile accepts zip files", async () => {
    const provider = createMockFilePickerProvider({
      pickFile: mock(() => Promise.resolve({
        uri: "file:///cache/proofmode.zip",
        name: "proofmode.zip",
        mimeType: "application/zip",
      })),
    });
    const file = await provider.pickFile(["image/*", "application/zip"]);
    expect(file!.mimeType).toBe("application/zip");
  });
});

export { createMockFilePickerProvider };
