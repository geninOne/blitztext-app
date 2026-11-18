// Ablauf einer Aufnahme, ohne DOM und ohne Tauri, damit er getestet werden kann.
//
// record_start blockiert, bis der Audiostrom laeuft (bei Bluetooth spuerbar
// lange). Kommt in dieser Zeit ein Stopp, etwa das Loslassen nach kurzem
// Antippen im Haltemodus, darf er nicht verloren gehen: sonst bliebe das
// Mikrofon offen, und das naechste Loslassen fuegte alles seit dem Antippen ein.
// Deshalb gibt es die Phase "starting" und den gemerkten Stoppwunsch.
//
// idle -> starting -> recording -> busy -> idle
//              \-> (Stopp gemerkt) -> busy (verwerfen) -> idle
//              \-> (Start gescheitert) -> idle

export type RecordingPhase = "idle" | "starting" | "recording" | "busy";

export class RecordingState {
  phase: RecordingPhase = "idle";
  private stopRequested = false;

  // Wahr von Startbeginn bis zum Ende der Auswertung: dann kein Update-Neustart
  // und kein zweiter Start.
  get active(): boolean {
    return this.phase !== "idle";
  }

  // Ein Stopp hat Wirkung: die Aufnahme laeuft oder startet gerade.
  get canStop(): boolean {
    return this.phase === "starting" || this.phase === "recording";
  }

  // Vor record_start. false: es laeuft schon etwas, nicht starten.
  beginStart(): boolean {
    if (this.phase !== "idle") return false;
    this.phase = "starting";
    this.stopRequested = false;
    return true;
  }

  // record_start ist gescheitert, das Mikrofon ist nicht offen.
  startFailed(): void {
    this.phase = "idle";
    this.stopRequested = false;
  }

  // record_start ist fertig. "record": die Aufnahme laeuft. "discard": waehrend
  // des Starts kam ein Stopp, also sofort record_stop und nichts auswerten;
  // die Phase steht dann auf "busy", bis finished() kommt.
  started(): "record" | "discard" {
    if (this.stopRequested) {
      this.stopRequested = false;
      this.phase = "busy";
      return "discard";
    }
    this.phase = "recording";
    return "record";
  }

  // Ein Stopp (Loslassen, zweiter Druck, Klick). "finish": jetzt record_stop und
  // auswerten. "deferred": gemerkt, started() verwirft danach. "ignore": nichts
  // zu stoppen.
  requestStop(): "finish" | "deferred" | "ignore" {
    if (this.phase === "recording") {
      this.phase = "busy";
      return "finish";
    }
    if (this.phase === "starting") {
      this.stopRequested = true;
      return "deferred";
    }
    return "ignore";
  }

  // Auswertung oder Verwerfen ist abgeschlossen.
  finished(): void {
    this.phase = "idle";
    this.stopRequested = false;
  }
}
