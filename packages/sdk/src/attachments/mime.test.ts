import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { inferMimeTypeFromFilename } from "./mime.ts";

describe("inferMimeTypeFromFilename", () => {
  test("maps known image extensions case-insensitively", () => {
    expect(inferMimeTypeFromFilename("photo.jpg")).toBe("image/jpeg");
    expect(inferMimeTypeFromFilename("photo.JPEG")).toBe("image/jpeg");
    expect(inferMimeTypeFromFilename("photo.PNG")).toBe("image/png");
    expect(inferMimeTypeFromFilename("clip.heic")).toBe("image/heic");
    expect(inferMimeTypeFromFilename("anim.webp")).toBe("image/webp");
  });

  test("falls back to application/octet-stream for unknown extensions", () => {
    expect(inferMimeTypeFromFilename("notes.txt")).toBe(
      "application/octet-stream",
    );
    expect(inferMimeTypeFromFilename("no-extension")).toBe(
      "application/octet-stream",
    );
  });
});
