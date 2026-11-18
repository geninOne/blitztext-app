import { describe, expect, it, vi } from "vitest";
import promptData from "../../shared/prompts.json";
import { newMode, systemPromptForMode } from "./modes";
import { deliveryFor, resolveModeId, rewriteOrKeep, runMode } from "./run-mode";

const deutsch = async () => "de" as const;
const englisch = async () => "en" as const;

describe("runMode", () => {
  it("ein Modus ohne Anweisung ruft chat nicht auf", async () => {
    const chat = vi.fn();
    expect((await runMode(newMode("Diktat"), "hallo", { chat, language: async () => "de" })).text).toBe("hallo");
    expect(chat).not.toHaveBeenCalled();
  });

  it("ein Modus mit Anweisung schickt den zusammengesetzten Systemprompt", async () => {
    const chat = vi.fn().mockResolvedValue("Hallo Jana,\n\nanbei.");
    const mode = newMode("Mail", "envelope.fill", "Schreib eine Mail.");
    const result = await runMode(mode, "hallo jana anbei", { chat, language: deutsch }, { terms: ["n8n"] });
    expect(result).toEqual({ text: "Hallo Jana,\n\nanbei.", aiFailed: false });
    expect(chat).toHaveBeenCalledTimes(1);
    const [system, user] = chat.mock.calls[0];
    expect(system).toBe(
      "Schreib eine Mail." +
        "\n\nWichtig: Diese Eigennamen und Fachbegriffe müssen exakt so geschrieben werden: n8n" +
        "\n\n" +
        promptData.spokenTranscriptRules.de,
    );
    expect(user).toBe("hallo jana anbei");
  });

  it("haengt die Diktatregeln an, in der Sprache des Transkripts", async () => {
    const chat = vi.fn().mockResolvedValue("ok");
    await runMode(newMode("Mail", "envelope.fill", "Schreib eine Mail."), "on Thursday", {
      chat,
      language: async () => "en",
    });
    expect(chat.mock.calls[0][0]).toContain("The user sends you a spoken transcript.");
  });

  it("waehlt Eigennamen-Satz, Kontext und Regeln in derselben Sprache", async () => {
    const chat = vi.fn().mockResolvedValue("ok");
    const language = vi.fn(englisch);
    const mode = newMode("Mail", "envelope.fill", "Write a mail.");
    await runMode(mode, "see you on thursday", { chat, language }, { terms: ["n8n"], context: "Hi" });
    expect(language).toHaveBeenCalledWith("see you on thursday");
    expect(chat.mock.calls[0][0]).toBe(
      systemPromptForMode(mode, ["n8n"], "Hi", "en") + "\n\n" + promptData.spokenTranscriptRules.en,
    );
  });

  it("schickt keine Rahmenregel und keinen gerahmten Text", async () => {
    const chat = vi.fn().mockResolvedValue("ok");
    await runMode(newMode("Mail", "envelope.fill", "X"), "roh", { chat, language: deutsch });
    expect(chat.mock.calls[0][0]).toBe("X\n\n" + promptData.spokenTranscriptRules.de);
    expect(chat.mock.calls[0][1]).toBe("roh");
  });

  it("wirft chat, bleibt das Transkript und aiFailed ist wahr", async () => {
    const chat = vi.fn().mockRejectedValue("HTTP 401: abgelehnt");
    const result = await runMode(newMode("Mail", "envelope.fill", "X"), "was gesagt wurde", { chat, language: deutsch });
    expect(result.text).toBe("was gesagt wurde");
    expect(result.aiFailed).toBe(true);
    expect(result.reason).toBe("HTTP 401: abgelehnt");
  });

  it("eine leere Antwort behaelt das Transkript und aiFailed ist wahr", async () => {
    for (const leer of ["", "  \n "]) {
      const chat = vi.fn().mockResolvedValue(leer);
      const result = await runMode(newMode("Mail", "envelope.fill", "X"), "was gesagt wurde", { chat, language: deutsch });
      expect(result).toEqual({ text: "was gesagt wurde", aiFailed: true, reason: "Die KI hat keinen Text geliefert." });
    }
  });

  it("ein leeres Transkript ruft chat nicht auf", async () => {
    const chat = vi.fn();
    expect(await runMode(newMode("Mail", "envelope.fill", "X"), "", { chat, language: deutsch })).toEqual({
      text: "",
      aiFailed: false,
    });
    expect(chat).not.toHaveBeenCalled();
  });

  it("scheitert die Spracherkennung, gelten deutsche Anweisungen", async () => {
    const chat = vi.fn().mockResolvedValue("ok");
    const language = vi.fn().mockRejectedValue(new Error("weg"));
    const result = await runMode(newMode("Mail", "envelope.fill", "X"), "hallo", { chat, language });
    expect(result).toEqual({ text: "ok", aiFailed: false });
    expect(chat.mock.calls[0][0]).toBe("X\n\n" + promptData.spokenTranscriptRules.de);
  });
});

describe("rewriteOrKeep", () => {
  it("liefert die Antwort des Modells", async () => {
    expect(await rewriteOrKeep("roh", async () => "fein")).toEqual({ text: "fein", aiFailed: false });
  });

  it("behaelt das Transkript, wenn der Schritt wirft", async () => {
    const result = await rewriteOrKeep("roh", async () => {
      throw new Error("kein Netz");
    });
    expect(result).toEqual({ text: "roh", aiFailed: true, reason: "kein Netz" });
  });

  it("behaelt das Transkript bei leerer Antwort", async () => {
    expect(await rewriteOrKeep("roh", async () => " ")).toEqual({
      text: "roh",
      aiFailed: true,
      reason: "Die KI hat keinen Text geliefert.",
    });
  });
});

describe("resolveModeId", () => {
  const mail = newMode("Mail", "envelope.fill", "X");

  it("erkennt die vier eingebauten Namen", () => {
    for (const workflow of ["transcribe", "improve", "dampf", "emoji"] as const) {
      expect(resolveModeId(workflow, [mail])).toEqual({ kind: "builtIn", workflow });
    }
  });

  it("ohne Kennung gilt Blitztext, wie bisher", () => {
    expect(resolveModeId("", [mail])).toEqual({ kind: "builtIn", workflow: "transcribe" });
  });

  it("findet einen eigenen Modus ueber seine Kennung", () => {
    expect(resolveModeId(mail.id, [mail])).toEqual({ kind: "custom", mode: mail });
  });

  it("eine geloeschte oder unbekannte Kennung loest nichts aus", () => {
    expect(resolveModeId(mail.id, [])).toBeNull();
    expect(resolveModeId("custom-gibt-es-nicht", [mail])).toBeNull();
    expect(resolveModeId("toString", [mail])).toBeNull();
  });
});

describe("deliveryFor", () => {
  it("fuegt ein, wenn der Modellschritt gelungen ist", () => {
    expect(deliveryFor({ text: "fertig", aiFailed: false })).toBe("paste");
  });

  it("kopiert nur, wenn der Modellschritt gescheitert ist", () => {
    expect(deliveryFor({ text: "was gesagt wurde", aiFailed: true })).toBe("copy");
  });

  it("ein leerer Text liefert nichts aus", () => {
    expect(deliveryFor({ text: "", aiFailed: false })).toBe("none");
    expect(deliveryFor({ text: "", aiFailed: true })).toBe("none");
  });
});
