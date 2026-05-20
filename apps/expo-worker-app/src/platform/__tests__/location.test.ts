import { describe, test, expect, mock } from "bun:test";
import type { LocationProvider } from "../location";

/** Create a mock LocationProvider for testing consumers. */
function createMockLocationProvider(overrides?: Partial<LocationProvider>): LocationProvider {
  return {
    requestPermission: mock(() => Promise.resolve(true)),
    getCurrentPosition: mock(() => Promise.resolve({ lat: 35.6595, lon: 139.7004 })),
    ...overrides,
  };
}

describe("LocationProvider contract", () => {
  test("requestPermission returns boolean", async () => {
    const provider = createMockLocationProvider();
    const granted = await provider.requestPermission();
    expect(typeof granted).toBe("boolean");
    expect(granted).toBe(true);
  });

  test("getCurrentPosition returns GpsCoord", async () => {
    const provider = createMockLocationProvider();
    const coord = await provider.getCurrentPosition();
    expect(coord).toHaveProperty("lat");
    expect(coord).toHaveProperty("lon");
    expect(coord.lat).toBeCloseTo(35.6595, 3);
    expect(coord.lon).toBeCloseTo(139.7004, 3);
  });

  test("denied permission returns false", async () => {
    const provider = createMockLocationProvider({
      requestPermission: mock(() => Promise.resolve(false)),
    });
    expect(await provider.requestPermission()).toBe(false);
  });

  test("getCurrentPosition can fail", async () => {
    const provider = createMockLocationProvider({
      getCurrentPosition: mock(() => Promise.reject(new Error("Location unavailable"))),
    });
    await expect(provider.getCurrentPosition()).rejects.toThrow("Location unavailable");
  });
});

export { createMockLocationProvider };
