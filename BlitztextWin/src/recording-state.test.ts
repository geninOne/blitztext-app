import { describe, expect, it } from "vitest";
import { RecordingState } from "./recording-state";

describe("RecordingState", () => {
  it("ein Stopp waehrend des Starts verwirft die Aufnahme", () => {
    const s = new RecordingState();
    expect(s.beginStart()).toBe(true);
    // hotkey-up kommt, waehrend record_start noch laeuft.
    expect(s.requestStop()).toBe("deferred");
    // record_start ist fertig: sofort stoppen und verwerfen.
    expect(s.started()).toBe("discard");
    expect(s.phase).toBe("busy");
    s.finished();
    expect(s.phase).toBe("idle");
  });

  it("ein Stopp nach dem Start wertet die Aufnahme aus", () => {
    const s = new RecordingState();
    s.beginStart();
    expect(s.started()).toBe("record");
    expect(s.phase).toBe("recording");
    expect(s.requestStop()).toBe("finish");
    expect(s.phase).toBe("busy");
    s.finished();
    expect(s.phase).toBe("idle");
  });

  it("ein zweiter Start waehrend des Starts wird ignoriert", () => {
    const s = new RecordingState();
    expect(s.beginStart()).toBe(true);
    expect(s.beginStart()).toBe(false);
    expect(s.phase).toBe("starting");
  });

  it("waehrend Aufnahme und Auswertung startet nichts Neues", () => {
    const s = new RecordingState();
    s.beginStart();
    s.started();
    expect(s.beginStart()).toBe(false);
    s.requestStop();
    expect(s.beginStart()).toBe(false);
  });

  it("ohne Aufnahme und waehrend der Auswertung tut ein Stopp nichts", () => {
    const s = new RecordingState();
    expect(s.requestStop()).toBe("ignore");
    s.beginStart();
    s.started();
    s.requestStop();
    expect(s.requestStop()).toBe("ignore");
  });

  it("ein gescheiterter Start gibt den Weg wieder frei und vergisst einen Stoppwunsch", () => {
    const s = new RecordingState();
    s.beginStart();
    s.requestStop();
    s.startFailed();
    expect(s.phase).toBe("idle");
    expect(s.beginStart()).toBe(true);
    expect(s.started()).toBe("record");
  });

  it("active ist wahr vom Startbeginn bis zum Ende der Auswertung", () => {
    const s = new RecordingState();
    expect(s.active).toBe(false);
    s.beginStart();
    expect(s.active).toBe(true);
    s.started();
    expect(s.active).toBe(true);
    s.requestStop();
    expect(s.active).toBe(true);
    s.finished();
    expect(s.active).toBe(false);
  });

  it("canStop gilt beim Start und waehrend der Aufnahme, nicht bei der Auswertung", () => {
    const s = new RecordingState();
    expect(s.canStop).toBe(false);
    s.beginStart();
    expect(s.canStop).toBe(true);
    s.started();
    expect(s.canStop).toBe(true);
    s.requestStop();
    expect(s.canStop).toBe(false);
  });
});
