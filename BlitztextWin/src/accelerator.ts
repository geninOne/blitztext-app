// Kuerzel-Texte und der Kuerzel-Rekorder, ohne DOM, damit die Regeln getestet
// werden koennen. Kuerzel nutzen die W3C-Namen aus KeyboardEvent.code
// ("Super+Shift+KeyD"); "Super" ist die Windows-Taste.

// Teile fuer die Abzeichen. Ohne Kuerzel (fehlend oder "") gibt es keine.
export function accelParts(accel: string | undefined): string[] {
  if (!accel) return [];
  return accel.split("+").map((part) => {
    if (part === "Super") return "Win";
    if (part === "Control") return "Ctrl";
    if (part.startsWith("Key")) return part.slice(3);
    if (part.startsWith("Digit")) return part.slice(5);
    return part;
  });
}

// Was der Rekorder von einem Tastendruck braucht.
export interface KeyLike {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

// wait: weiter auf die eigentliche Taste warten (nur ein Modifikator gedrueckt).
// reject: diese Kombination taugt nicht als globales Kuerzel, reason sagt warum.
// accept: das Kuerzel zum Anmelden.
export type CaptureResult =
  | { kind: "wait" }
  | { kind: "reject"; reason: string }
  | { kind: "accept"; accel: string };

const NEEDS_MODIFIER = "Bitte mit Win, Strg oder Alt kombinieren";

// Ein globales Kuerzel greift in jedem Programm. Ohne Modifikator oder nur mit
// Umschalt waere es ein normaler (Gross-)Buchstabe, und jedes Tippen dieses
// Buchstabens wuerde ein Diktat starten. Deshalb braucht es Win, Strg oder Alt.
export function captureFromKey(event: KeyLike): CaptureResult {
  if (/^(Meta|Control|Alt|Shift)(Left|Right)$/.test(event.code)) return { kind: "wait" };
  if (!event.code) return { kind: "wait" };
  const mods: string[] = [];
  if (event.metaKey) mods.push("Super");
  if (event.ctrlKey) mods.push("Control");
  if (event.altKey) mods.push("Alt");
  if (event.shiftKey) mods.push("Shift");
  if (!event.metaKey && !event.ctrlKey && !event.altKey) {
    return { kind: "reject", reason: NEEDS_MODIFIER };
  }
  return { kind: "accept", accel: [...mods, event.code].join("+") };
}

// Ziel eines Ereignisses, so weit es hier zaehlt.
export interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
}

// Tippen in Name, Anweisung oder ein anderes Feld ist nie ein Kuerzel.
export function isEditableTarget(target: TargetLike | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
