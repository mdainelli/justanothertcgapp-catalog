import { describe, expect, it } from "vitest";
import { validateInstallHash, validateProposal } from "../src/validation";
import { VALID_PROPOSAL } from "./helpers";

const v = (patch: Record<string, unknown>) => validateProposal({ ...VALID_PROPOSAL, ...patch });

describe("validateProposal", () => {
  it("accepts the spec example and trims strings", () => {
    expect(validateProposal(VALID_PROPOSAL)).toEqual(VALID_PROPOSAL);
    expect(v({ name: "  Mew  " }).name).toBe("Mew");
  });
  it("defaults optional fields", () => {
    const p = validateProposal({
      formatVersion: 1, lang: "en", setName: "Promo", localId: "X1", name: "Pika",
      variants: { normal: true, reverse: false, holo: false, firstEdition: false },
    });
    expect(p).toMatchObject({ setId: null, category: null, rarity: null, illustrator: null, types: [], hp: null });
    expect("description" in p).toBe(false);
  });
  it("rejects unknown fields (top level and variants)", () => {
    expect(() => v({ extra: 1 })).toThrow();
    expect(() => v({ variants: { ...VALID_PROPOSAL.variants, foo: true } })).toThrow();
  });
  it.each([
    ["formatVersion", 2],
    ["lang", "xx"],
    ["name", ""],
    ["name", "a".repeat(101)],
    ["name", "a\nb"],
    ["localId", "a b"],
    ["localId", "1".repeat(21)],
    ["category", "Stadium"],
    ["types", ["Banana"]],
    ["hp", 1.5],
    ["hp", 0],
    ["hp", "120"],
    ["description", "d".repeat(1001)],
    ["variants", { normal: true }],
  ])("rejects %s=%j", (k, val) => {
    expect(() => v({ [k]: val })).toThrow();
  });
  it("requires setName when setId is null", () => {
    expect(() => v({ setId: null, setName: null })).toThrow();
    expect(v({ setId: null, setName: "Promo X" }).setName).toBe("Promo X");
  });
  it("rejects non-objects", () => {
    expect(() => validateProposal([])).toThrow();
    expect(() => validateProposal(null)).toThrow();
  });
  it("validates the install hash", () => {
    expect(validateInstallHash("b".repeat(64))).toBe("b".repeat(64));
    expect(() => validateInstallHash("xyz")).toThrow();
    expect(() => validateInstallHash(null)).toThrow();
  });
});
