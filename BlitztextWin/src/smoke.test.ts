import { describe, it, expect } from "vitest";
import { normalizeBaseUrl } from "./config";

describe("normalizeBaseUrl", () => {
  it("entfernt abschliessenden Schraegstrich und /v1", () => {
    expect(normalizeBaseUrl("http://host:4000/v1/")).toBe("http://host:4000");
  });

  it("entfernt auch /ui", () => {
    expect(normalizeBaseUrl("http://host:4000/ui/")).toBe("http://host:4000");
  });

  it("ignoriert Gross- und Kleinschreibung", () => {
    expect(normalizeBaseUrl("http://host:4000/V1")).toBe("http://host:4000");
  });

  it("entfernt mehrere Segmente hintereinander", () => {
    expect(normalizeBaseUrl("http://host:4000/v1/ui")).toBe("http://host:4000");
  });
});
