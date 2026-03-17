import { describe, test, expect, mock } from "bun:test";
import type { CameraProvider, CapturedPhoto } from "../camera";

/** Inline fileToPhoto for testing without react-native import. */
function fileToPhoto(file: File): CapturedPhoto {
  return {
    uri: URL.createObjectURL(file),
    filename: file.name,
    mimeType: file.type || "image/jpeg",
  };
}

function createMockCameraProvider(overrides?: Partial<CameraProvider>): CameraProvider {
  return {
    hasLiveViewfinder: true,
    requestPermission: mock(() => Promise.resolve(true)),
    ...overrides,
  };
}

describe("CameraProvider contract", () => {
  test("requestPermission returns boolean", async () => {
    const provider = createMockCameraProvider();
    expect(await provider.requestPermission()).toBe(true);
  });

  test("hasLiveViewfinder is true for native", () => {
    const native = createMockCameraProvider({ hasLiveViewfinder: true });
    expect(native.hasLiveViewfinder).toBe(true);
  });

  test("hasLiveViewfinder is false for web", () => {
    const web = createMockCameraProvider({ hasLiveViewfinder: false });
    expect(web.hasLiveViewfinder).toBe(false);
  });

  test("denied permission returns false", async () => {
    const provider = createMockCameraProvider({
      requestPermission: mock(() => Promise.resolve(false)),
    });
    expect(await provider.requestPermission()).toBe(false);
  });
});

describe("fileToPhoto", () => {
  test("converts File to CapturedPhoto", () => {
    const file = new File(["data"], "test.jpg", { type: "image/jpeg" });
    const photo = fileToPhoto(file);
    expect(photo.filename).toBe("test.jpg");
    expect(photo.mimeType).toBe("image/jpeg");
    expect(photo.uri).toStartWith("blob:");
    URL.revokeObjectURL(photo.uri);
  });

  test("defaults mimeType to image/jpeg for empty type", () => {
    const file = new File(["data"], "test.bin", { type: "" });
    const photo = fileToPhoto(file);
    expect(photo.mimeType).toBe("image/jpeg");
    URL.revokeObjectURL(photo.uri);
  });
});

export { createMockCameraProvider };
