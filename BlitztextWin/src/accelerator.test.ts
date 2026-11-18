import { describe, expect, it } from "vitest";
import { accelParts, captureFromKey, isEditableTarget } from "./accelerator";

// Ein Tastendruck, wie ihn der Rekorder sieht; nur die Felder, die zaehlen.
function taste(code: string, mods: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) {
  return {
    code,
    metaKey: mods.meta ?? false,
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
  };
}

describe("captureFromKey", () => {
  it("nimmt Win+Umschalt+D an", () => {
    expect(captureFromKey(taste("KeyD", { meta: true, shift: true }))).toEqual({
      kind: "accept",
      accel: "Super+Shift+KeyD",
    });
  });

  it("nimmt Strg+Alt+Ziffer an", () => {
    expect(captureFromKey(taste("Digit5", { ctrl: true, alt: true }))).toEqual({
      kind: "accept",
      accel: "Control+Alt+Digit5",
    });
  });

  it("lehnt Umschalt als einzigen Modifikator ab, sonst waere jeder Grossbuchstabe ein globales Kuerzel", () => {
    const ergebnis = captureFromKey(taste("KeyB", { shift: true }));
    expect(ergebnis.kind).toBe("reject");
  });

  it("lehnt eine Taste ganz ohne Modifikator ab", () => {
    expect(captureFromKey(taste("KeyB")).kind).toBe("reject");
  });

  it("wartet, solange nur ein Modifikator gedrueckt ist", () => {
    expect(captureFromKey(taste("ShiftLeft", { shift: true }))).toEqual({ kind: "wait" });
    expect(captureFromKey(taste("MetaRight", { meta: true }))).toEqual({ kind: "wait" });
  });

  it("wartet bei einem Ereignis ohne Tastencode", () => {
    expect(captureFromKey(taste("", { ctrl: true }))).toEqual({ kind: "wait" });
  });
});

describe("isEditableTarget", () => {
  it("erkennt Eingabefelder, Textbereiche und bearbeitbare Elemente", () => {
    expect(isEditableTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isEditableTarget({ tagName: "SELECT" })).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("Knoepfe und leere Ziele sind nicht bearbeitbar", () => {
    expect(isEditableTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
  });
});

describe("accelParts", () => {
  it("zeigt Win, Ctrl und den Buchstaben", () => {
    expect(accelParts("Super+Control+KeyD")).toEqual(["Win", "Ctrl", "D"]);
  });

  it("ohne Kuerzel gibt es keine Teile", () => {
    expect(accelParts("")).toEqual([]);
    expect(accelParts(undefined)).toEqual([]);
  });
});
