import { describe, expect, it } from "vitest";
import { validateInstallHash } from "../src/validation";

describe("validateInstallHash", () => {
  it("accepts 64 lowercase hex characters", () => {
    expect(validateInstallHash("a".repeat(64))).toBe("a".repeat(64));
  });
  it("rejects anything else", () => {
    for (const v of [undefined, null, 5, "", "A".repeat(64), "a".repeat(63), "g".repeat(64)]) {
      expect(() => validateInstallHash(v)).toThrow();
    }
  });
});
