// Eigene Modi anlegen, bearbeiten und loeschen. Die Zustandsfunktionen oben
// sind rein und getestet; renderModeList zeichnet den Abschnitt und wird von
// Hand geprueft, weil die Tests ohne DOM laufen. Vorbild ist
// CustomModesSection.swift auf dem Mac.
import type { Settings } from "./config";
import { iconFor, modeSymbols } from "./mode-icons";
import { hasInstruction, modeFromTemplate, modeTemplates, newMode, type CustomMode } from "./modes";

type ModeColor = NonNullable<CustomMode["color"]>;

// ---------------------------------------------------------------- Zustand

// Haengt einen neuen Modus hinten an.
export function addMode(settings: Settings, mode: CustomMode): void {
  settings.modes.push(mode);
}

// Ersetzt den Modus mit derselben Kennung; eine unbekannte Kennung aendert nichts.
export function updateMode(settings: Settings, mode: CustomMode): void {
  const index = settings.modes.findIndex((m) => m.id === mode.id);
  if (index >= 0) settings.modes[index] = mode;
}

// Entfernt den Modus und seinen Eintrag in settings.hotkeys.
export function removeMode(settings: Settings, id: string): { hadHotkey: boolean } {
  settings.modes = settings.modes.filter((m) => m.id !== id);
  const hadHotkey = Object.prototype.hasOwnProperty.call(settings.hotkeys, id);
  delete settings.hotkeys[id];
  return { hadHotkey };
}

// Haengt ein Kuerzel an eine Kennung, nachdem set_hotkey es registriert hat.
// Wie im Rust-Kern verliert jeder andere Halter dieselbe Kombination; die
// Kennungen, die ihr Kuerzel so verloren haben, kommen zurueck. Ihr Eintrag
// wird leer statt geloescht: ein fehlender Workflow-Eintrag bekaeme beim
// naechsten Laden seinen Standard zurueck (settings-store.ts).
export function assignHotkey(settings: Settings, id: string, accelerator: string): string[] {
  const lost = Object.keys(settings.hotkeys).filter(
    (key) => key !== id && settings.hotkeys[key] === accelerator,
  );
  for (const key of lost) settings.hotkeys[key] = "";
  settings.hotkeys[id] = accelerator;
  return lost;
}

// Name fuer die Liste; ein leerer Name erscheint nie als leere Zeile.
export function displayName(mode: CustomMode): string {
  const name = mode.name.trim();
  return name.length > 0 ? name : "Ohne Namen";
}

// ------------------------------------------------------------- Darstellung

export interface ModeEvents {
  add(mode: CustomMode): void;
  update(mode: CustomMode): void;
  remove(id: string): void;
  // Kuerzel-Abzeichen einer Kennung, vom Rekorder in popover.ts aktuell gehalten.
  hotkeyDisplay(id: string): HTMLElement;
  // Abzeichen samt Knoepfen zum Aufnehmen und Entfernen, ebenfalls aus dem Rekorder.
  hotkeyEditor(id: string): HTMLElement;
}

const COLORS: { value: ModeColor; label: string }[] = [
  { value: "day", label: "Blau" },
  { value: "evening", label: "Violett" },
  { value: "night", label: "Lila" },
];

// Fehlende oder unbekannte Farbe gilt als Violett, wie colorChoice auf dem Mac.
function colorOf(mode: CustomMode): ModeColor {
  return COLORS.some((c) => c.value === mode.color) ? mode.color! : "evening";
}

function tint(element: HTMLElement, mode: CustomMode): void {
  element.style.setProperty("--tint", `var(--mode-${colorOf(mode)})`);
}

// Anfang der Anweisung, damit sich Modi auseinanderhalten lassen.
function summary(mode: CustomMode): string {
  if (!hasInstruction(mode)) return "Ohne Anweisung: wortgenau";
  return mode.prompt.trim().split("\n")[0];
}

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function field(title: string, ...content: HTMLElement[]): HTMLElement {
  const wrap = make("div", "mode-field");
  wrap.append(make("div", "sub-label", title), ...content);
  return wrap;
}

// Welcher Modus aufgeklappt ist und ob die Vorlagenauswahl offen steht,
// je Container, damit ein Neuzeichnen beides behaelt.
const openState = new WeakMap<HTMLElement, { expanded: string | null; picker: boolean }>();

export function renderModeList(container: HTMLElement, settings: Settings, on: ModeEvents): void {
  const state = openState.get(container) ?? { expanded: null, picker: false };
  openState.set(container, state);
  const rerender = () => renderModeList(container, settings, on);

  container.innerHTML = "";

  if (settings.modes.length === 0) {
    container.append(make("p", "hint", "Noch kein eigener Modus angelegt."));
  }

  for (const mode of settings.modes) {
    const expanded = state.expanded === mode.id;
    const item = make("div", expanded ? "mode-item open" : "mode-item");

    // Kopfzeile: Symbol, Name, Anfang der Anweisung, Kuerzel, Pfeil.
    const head = make("button", "mode-row");
    head.type = "button";
    head.title = expanded ? "Zuklappen" : "Bearbeiten";
    const glyph = make("span", "mode-glyph");
    const text = make("span", "mode-text");
    const name = make("span", "mode-name");
    const sub = make("span", "mode-sub");
    text.append(name, sub);
    const chevron = make("span", "mode-chevron", expanded ? "⌃" : "⌄");
    head.append(glyph, text, on.hotkeyDisplay(mode.id), chevron);
    head.addEventListener("click", () => {
      state.expanded = expanded ? null : mode.id;
      rerender();
    });
    item.append(head);

    let current: CustomMode = { ...mode };
    const refreshHead = () => {
      glyph.replaceChildren(iconFor(current.icon, 16));
      tint(glyph, current);
      name.textContent = displayName(current);
      sub.textContent = summary(current);
    };
    refreshHead();

    if (expanded) {
      const editor = make("div", "mode-editor");
      const change = (patch: Partial<CustomMode>) => {
        current = { ...current, ...patch };
        on.update(current);
        refreshHead();
      };

      const nameInput = make("input");
      nameInput.type = "text";
      nameInput.placeholder = "z. B. Als E-Mail";
      nameInput.value = current.name;
      nameInput.addEventListener("input", () => change({ name: nameInput.value }));

      const symbols = make("div", "mode-symbols");
      const symbolButtons: HTMLButtonElement[] = [];
      for (const symbol of modeSymbols()) {
        const button = make("button", "mode-symbol");
        button.type = "button";
        button.title = symbol;
        button.dataset.symbol = symbol;
        button.append(iconFor(symbol, 15));
        button.addEventListener("click", () => {
          change({ icon: symbol });
          markSymbols();
        });
        symbolButtons.push(button);
        symbols.append(button);
      }
      const markSymbols = () => {
        tint(symbols, current);
        for (const b of symbolButtons) b.classList.toggle("active", b.dataset.symbol === current.icon);
      };
      markSymbols();

      const colors = make("div", "mode-colors");
      const colorLabel = make("span", "mode-color-label");
      const colorButtons: HTMLButtonElement[] = [];
      for (const color of COLORS) {
        const button = make("button", "mode-color");
        button.type = "button";
        button.title = color.label;
        button.setAttribute("aria-label", color.label);
        button.dataset.color = color.value;
        button.style.setProperty("--tint", `var(--mode-${color.value})`);
        button.addEventListener("click", () => {
          change({ color: color.value });
          markColors();
          markSymbols();
        });
        colorButtons.push(button);
        colors.append(button);
      }
      colors.append(colorLabel);
      const markColors = () => {
        const chosen = colorOf(current);
        for (const b of colorButtons) b.classList.toggle("active", b.dataset.color === chosen);
        colorLabel.textContent = COLORS.find((c) => c.value === chosen)!.label;
      };
      markColors();

      const prompt = make("textarea");
      prompt.rows = 4;
      prompt.placeholder = "z. B. „Formuliere den Text als kurze, freundliche Antwort an einen Kunden.“";
      prompt.value = current.prompt;
      prompt.addEventListener("input", () => change({ prompt: prompt.value }));
      const promptHint = make(
        "p",
        "hint",
        "Geht mit deinem gesprochenen Text an das KI-Modell. Ohne Anweisung bleibt der Text wortgenau.",
      );

      const remove = make("button", "mode-delete", "Modus löschen");
      remove.type = "button";
      remove.addEventListener("click", () => {
        state.expanded = null;
        on.remove(mode.id);
      });

      editor.append(
        field("Name", nameInput),
        field("Symbol", symbols),
        field("Farbe", colors),
        field("Anweisung", prompt, promptHint),
        field("Kürzel", on.hotkeyEditor(mode.id)),
        remove,
      );
      item.append(editor);
    }

    container.append(item);
  }

  // "Modus anlegen": leer oder aus einer Vorlage, deren Name noch frei ist.
  const actions = make("div", "actions mode-actions");
  const addButton = make("button", "", "+ Modus anlegen");
  addButton.type = "button";
  addButton.addEventListener("click", () => {
    state.picker = !state.picker;
    rerender();
  });
  actions.append(addButton);
  container.append(actions);

  if (state.picker) {
    const picker = make("div", "mode-picker");
    const create = (mode: CustomMode) => {
      state.picker = false;
      state.expanded = mode.id;
      on.add(mode);
    };
    const blank = make("button", "", "Leer");
    blank.type = "button";
    blank.addEventListener("click", () => create(newMode("Neuer Modus")));
    picker.append(blank);

    const taken = new Set(settings.modes.map((m) => m.name));
    for (const template of modeTemplates().filter((t) => !taken.has(t.name))) {
      const button = make("button");
      button.type = "button";
      button.append(iconFor(template.icon, 14), document.createTextNode(template.name));
      button.addEventListener("click", () => create(modeFromTemplate(template)));
      picker.append(button);
    }
    container.append(picker);
  }
}
