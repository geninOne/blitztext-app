// Symbole der eigenen Modi. Gespeichert wird der SF-Symbol-Name des Macs, damit
// die Daten zwischen beiden Apps passen; angezeigt wird das naechstliegende
// Lucide-Symbol laut shared/mode-icons.json.
import {
  Briefcase,
  createElement,
  FileText,
  Globe,
  Hash,
  Lightbulb,
  List,
  ListChecks,
  ListPlus,
  Mail,
  MessageSquareQuote,
  Reply,
  Users,
  WandSparkles,
  type IconNode,
} from "lucide";
import iconMap from "../../shared/mode-icons.json";

// Nur die hier eingebundenen Symbole landen im Paket. Kommt in der Datei ein
// neuer Name dazu, muss er auch hier stehen; der Test prueft das.
const LUCIDE: Record<string, IconNode> = {
  Briefcase,
  FileText,
  Globe,
  Hash,
  Lightbulb,
  List,
  ListChecks,
  ListPlus,
  Mail,
  MessageSquareQuote,
  Reply,
  Users,
  WandSparkles,
};

const MAP: Record<string, string> = iconMap;
const FALLBACK = "wand.and.stars";

// Die Auswahl im Editor, in der Reihenfolge von CustomMode.symbols.
export function modeSymbols(): string[] {
  return Object.keys(MAP);
}

// Lucide-Name zu einem SF-Symbol; Unbekanntes faellt auf wand.and.stars zurueck.
export function lucideNameFor(symbol: string): string {
  const name = MAP[symbol];
  return name && name in LUCIDE ? name : MAP[FALLBACK];
}

export function iconFor(symbol: string, size = 16): SVGElement {
  return createElement(LUCIDE[lucideNameFor(symbol)], {
    width: size,
    height: size,
    "stroke-width": 2,
    "aria-hidden": "true",
  });
}
