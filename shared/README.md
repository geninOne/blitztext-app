# shared/

Single source of truth for the small, platform-agnostic pieces that both apps
(the macOS Swift app in `BlitztextMac/` and the Windows Tauri app in
`BlitztextWin/`) must keep in sync.

Most of each app is platform-specific (UI, audio, hotkeys, paste, tray) and
lives in the app folders. Only the following overlap, so they are defined once
here and ported/loaded by each app:

- `prompts.json`: the system prompts and their dynamic parts (tones, emoji
  density, vocabulary hints). Fuer die eigenen Modi kamen dazu:
  - `modeTemplates`: die Vorlagen fuer neue Modi (id, name, icon, prompt) in
    Anzeigereihenfolge; die Kennungen bleiben stabil.
  - `spokenTranscriptRules`: Regeln fuer gesprochene Transkripte (`de`, `en`),
    die hinter jede Anweisung eines eigenen Modus gehaengt werden.
  - `modeFrames`: Rahmentexte fuer Eigennamen (`customTerms`) und den Text um
    den Cursor (`fieldContext`), je Sprache (`de`, `en`).
- `mode-icons.json`: SF-Symbol-Namen der Modi (wie auf dem Mac gespeichert)
  zum naechstliegenden Lucide-Symbol fuer Windows. Die Reihenfolge ist die
  Auswahl im Editor. Ein neuer Eintrag braucht das Lucide-Symbol auch in
  `BlitztextWin/src/mode-icons.ts`; ein Test prueft das.
- `gateway-contract.md`: the OpenAI-compatible request/response contract used
  for transcription and chat, including two gateway-specific gotchas.
- `config-schema.json`: the provider/model configuration shape, plus die
  Felder der eigenen Modi (`customMode`, `modes`), die Kuerzel je
  Modus-Kennung (`hotkeys`, mit der Bedeutung von `""`),
  `hasSeededCustomModes` und `settingsVersion`.

When you change a prompt or the config shape, change it here and mirror it into
both apps in the same pull request.
