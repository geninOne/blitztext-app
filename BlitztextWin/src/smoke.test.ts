import { describe, it, expect } from "vitest";
import { normalizeBaseUrl } from "./config";

describe("normalizeBaseUrl", () => {
  it("entfernt abschliessenden Schraegstrich und /v1", () => {
    expect(normalizeBaseUrl("http://host:4000/v1/")).toBe("http://host:4000");
  });
});
