# Blitztext Windows App — Handoff / Continuation Notes

Status snapshot for continuing the Windows app in a fresh session. Read this
first, then `shared/gateway-contract.md` and `shared/prompts.json`.

## Goal & key decisions

- evia wants Blitztext (the macOS Swift dictation app) also on **Windows**.
- **Decision: keep the macOS Swift app as-is; build a SEPARATE Windows app in the
  SAME repo (monorepo).** Not a rewrite of the Mac app. Reason: most code is
  platform-specific and can't be shared between Swift and the Windows stack
  anyway; only a small logic layer overlaps (kept in `shared/`).
- **Stack: Tauri v2 (Rust core + TypeScript/web UI).** The developer is a JS/TS
  dev but is fine writing some Rust. Native must-haves (secret store, gateway
  HTTP, later hotkey + paste + audio) live in Rust; UI in TS.
- **Online (LiteLLM gateway) is mandatory; local transcription is nice-to-have**
  and deferred to M3 (via whisper.cpp / `whisper-rs`, NOT WhisperKit which is
  Apple-only).

## Repo / branch state

- Remotes: `origin` = github.com/geninOne/blitztext-app (push target; the
  active `gh` account must be **geninOne**, which holds the `workflow` scope).
  `upstream` = cmagnussen/blitztext-app (do NOT push there).
- macOS app at repo root: `BlitztextMac/`, `build.sh` — untouched by Windows work.
- Windows app: `BlitztextWin/` (Tauri v2 vanilla-ts).
- `shared/`: single source for prompts, gateway contract, config schema.
- **Active branch: `windows/tauri-mvp`** (pushed to origin).
- macOS CI/release already merged to `main` (`.github/workflows/macos-release.yml`):
  PRs build a downloadable artifact; push to `main` publishes a `v0.1.<run>`
  prerelease; a `v*` tag publishes an official release.

## Gateway details (for testing)

- URL: `http://ai-gateway.intra.evia.de:4000` (plain HTTP, intranet — the dev Mac
  must be on the evia network/VPN to reach it).
- Models available on the gateway: **`gpt-4o-transcribe`** (transcription) and
  **`gpt-5.5`** (chat). NOTE: `gpt-4o-mini` is NOT on the gateway, so set the
  "fast" model to `gpt-5.5` (or register the model in LiteLLM).
- Contract gotchas (see `shared/gateway-contract.md`):
  - Omit `temperature` for the gateway (GPT-5 rejects any non-default → HTTP 400).
  - Transcription returns JSON even with `response_format=text` → parse the
    top-level `text` field, fall back to the raw body.

## Windows app — what exists now (`BlitztextWin/`)

Rust (`src-tauri/src/lib.rs`), all registered in `invoke_handler`:
- `secret_set` / `secret_get` / `secret_has` — `keyring` crate, service
  `app.blitztext.win`, account `liteLLMApiKey` (macOS Keychain / Windows
  Credential Manager).
- `gateway_test(base_url)` — GET `/v1/models` (reqwest + rustls), returns model ids.
- `transcribe(base_url, model, language, audio_base64, filename, content_type)` —
  multipart POST `/v1/audio/transcriptions`; defensive JSON/text response parse.
- Helpers: `normalize_base()` (strips trailing slash and `/v1`), `litellm_key()`
  (reads the key from keyring so it never reaches the frontend).
- Cargo deps added: `keyring` (features apple-native, windows-native),
  `reqwest` (rustls-tls, json, multipart), `base64`.
- `src-tauri/Info.plist`: `NSMicrophoneUsageDescription` (mic permission for mac dev).

Frontend (`src/main.ts`, `src/config.ts`, `index.html`):
- Settings form: provider (liteLLM/openAI), gateway URL, three model fields.
  Non-secret settings in `localStorage`; API key only via keyring.
- "Verbindung testen" button → `gateway_test`.
- "Diktat testen": `MediaRecorder` → base64 → `transcribe`, with audio playback
  and byte-size diagnostics.

## What works

- App launches on the Mac (`npm run tauri dev`).
- Settings save/load + secure key storage (keyring) — works.
- "Verbindung testen" — works, lists `gpt-4o-transcribe`, `gpt-5.5`.
- Record → upload → transcribe pipeline works **mechanically** (the earlier
  "corrupted/unsupported" error was fixed by aligning the file extension and
  content-type to the real `MediaRecorder` mime type, which on macOS WKWebView is
  typically `audio/mp4`).

## Audio quality (resolved enough for MVP)

- The earlier "bescheiden"/hallucination problem was mostly the `getUserMedia`
  processing filters fighting a mediocre signal. **Fix applied:** turned
  `echoCancellation` / `noiseSuppression` / `autoGainControl` **off** (raw signal
  is better for dictation), kept mono + `audioBitsPerSecond: 128000`. Recording
  still follows the OS default input device (no `deviceId`) — user sets the
  headset as the macOS default in System Settings → Sound → Input.
- Mono is intentional; the "voice only in the left ear" the user noticed is a
  harmless playback artifact of a single-channel file, not a capture problem.
- **Fallback still on the table if Windows audio turns out poor:** switch
  recording to Rust `cpal` → WAV (the `transcribe` command already accepts
  `content_type`/`filename`). cpal `Stream` is `!Send`: use a dedicated thread
  owning the stream, an `Arc<Mutex<Vec<f32>>>` buffer + `AtomicBool` stop flag,
  write WAV with `hound`. Not needed unless WebView2 audio disappoints.

## Hotkey decision (step 6)

- macOS app uses **`fn` + {Shift|Ctrl|Option|Cmd}** pure-modifier combos for its
  four workflows, modes `hold` (default) / `toggle`, Escape cancels.
- `fn` is NOT bindable on Windows, and **modifier-only combos cannot be
  registered as global shortcuts** there. So on Windows the Windows/Super key
  takes `fn`'s role but a real key is required alongside it.
- **Chosen for the MVP:** `Win+Shift+D` (Super+Shift+KeyD; = Cmd+Shift+D on the
  Mac dev machine), **hold-to-talk** for the transcribe workflow. The other three
  workflows will be added as `Win+Shift+{other key}` in step 8.
- The official `tauri-plugin-global-shortcut` v2 reports both `Pressed` and
  `Released`, so hold-to-talk works without `rdev`. If true Mac parity (pure
  modifier-only combos) is later wanted, switch to an `rdev` low-level hook.

## Plan — remaining steps

M1 (online-only):
1. ✅ Scaffold Tauri + `shared/`
2. ✅ `shared/` content (prompts, gateway contract, config schema)
3. ✅ Config + secure key storage + settings UI
4. ✅ Gateway client + connection test
5. ✅ Audio capture + transcription — works; processing filters disabled for
   quality, mono + 128 kbps, follows OS default input device
6. ✅ Tray + push-to-talk global hotkey — `Win+Shift+D` (default) hold-to-talk
   wired to the transcribe workflow; tray menu (show / quit). Rust emits
   `hotkey-down` / `hotkey-up`; webview start/stops the recorder.
   - **Configurable hotkeys:** `HotkeyMap` state (Shortcut → workflow id) +
     `set_hotkey(workflow, accelerator)` command rebinds at runtime (frees the
     old/colliding combo first). Frontend has a key-capture recorder (Settings →
     Tastenkürzel) storing accelerators as W3C `KeyboardEvent.code` strings
     (e.g. "Super+Shift+KeyD") in `settings.hotkeys`; it re-registers on load.
   - **Close-to-tray:** `CloseRequested` hides the window + `prevent_close()` so
     the background hotkey survives; tray "Beenden" is the real quit.
   - Next: add the other three workflows as their own hotkeys + a hold/toggle
     mode setting (Mac parity) — pairs naturally with step 8.
7. ✅ Paste into the active app — `paste_text(text)` command: writes the
   clipboard (`arboard`), then sends Cmd/Ctrl+V via `enigo`. Wired into the
   recorder's onstop after a successful transcript. Window stays hidden in the
   tray so the paste lands in the previously focused app.
   - **macOS caveat:** the synthetic keystroke needs Accessibility permission
     (System Settings → Privacy & Security → Accessibility) for the dev binary;
     Windows needs no prompt. First attempt may silently no-op until granted.
8. ✅ Full workflow: record → transcribe → optional rewrite → paste.
   - `chat_complete(base_url, model, system, user)` Rust command (POST
     `/v1/chat/completions`, temperature omitted, reads
     `choices[0].message.content`).
   - Four workflows (transcribe / improve / dampf / emoji), each with its own
     configurable hotkey (defaults `Win+Shift+{D,I,A,E}`). The `hotkey-down`
     event carries the workflow id; the webview tags the recording with it and,
     on stop, runs the matching chat step (model: dampf → strongModel, else
     fastModel) before pasting.
   - Prompts come from `shared/prompts.json` via `src/prompts.ts`
     (`systemPromptFor`); Vite `server.fs.allow: ['..']` permits the import.
     MVP uses fixed defaults: neutral tone, medium emoji density, no custom
     terms/context UI yet.
9. ⬜ Verify on mac dev + on Windows.

## Settings UI parity (matches the macOS two-tab layout)

- Two-tab segmented layout like `SettingsContentView.swift`: **Anpassen** and
  **Zugang**, with quiet uppercase section labels.
- **Anpassen:** Tastenkürzel (4 workflows + capture/reset), Blitztext+
  (Schreibstil Formell/Neutral/Locker · Eigene Anweisung · Kontext), Blitztext
  $%&! (Eigene Anweisung), Blitztext :) (Emoji-Dichte Wenig/Mittel/Viel),
  Eigennamen (chips + add). All saved immediately on change.
- **Zugang:** Anbieter (LiteLLM/OpenAI segmented) + URL/Key/Modelle behind the
  "Speichern" button; **Autostart** toggle ("Beim Anmelden").
- These settings actually drive the prompts: `src/prompts.ts` `systemPromptFor`
  assembles exactly like `LLMService.swift` `buildSystemPrompt` (custom
  instruction overrides base+tone but keeps custom terms; context appended;
  emoji density; dampf custom-or-default) from `shared/prompts.json`.
- Autostart: `tauri-plugin-autostart` + `set_autostart`/`get_autostart` Rust
  commands (LaunchAgent on macOS, Run key on Windows).
- **Dropped (macOS-only):** Installation, Bedienungshilfen, Sauber Entfernen,
  Sicherer Lokaler Modus (local Whisper is M3).

## Tray popover UI (matches the macOS menu-bar dropdown)

- **Single window** `main` (in `tauri.conf.json`): frameless, transparent,
  always-on-top, skip-taskbar, `visible:false`, 380×540. `index.html` +
  `src/popover.ts`. `macOSPrivateApi:true` (+ tauri `macos-private-api`
  feature) so the transparent rounded popover works on the mac dev machine.
  Single Vite page (no multi-page input).
- The window holds **two views** toggled in JS: `#view-menu` (status, Online
  Whisper card, four workflow rows with hotkey badges, Beenden) and
  `#view-settings` (the ‹ Zurück header + two-tab Anpassen/Zugang UI). The gear
  shows settings, ‹ Zurück returns to the menu — same window, like the macOS app.
- Tray: left-click toggles the popover (or stops an active recording via
  `popover-stop`); right-click menu = Einstellungen (shows popover + emits
  `open-settings`) / Beenden. `show_menu_on_left_click(false)`.
- **Positioning:** every tray event stores the icon's `Rect` in `TrayRect`
  state; `show_popover()` computes a logical position from it (centered on the
  icon, below on macOS / above on Windows) and `set_position`s BEFORE `show()`,
  so the first open is already correct (the positioner-plugin approach left the
  first open centered, so it was dropped — the dep is still in Cargo but unused).
- **Hotkey mode** (`settings.hotkeyMode`, segmented Halten/Drücken under
  Tastenkürzel): "hold" = down starts / up stops; "toggle" = press starts,
  press again / Esc / tray click stops (auto-repeat debounced 500ms).
- Stored dampf prompt falls back to the default text when empty, so the
  pre-filled instruction is always visible.
- Popover transient: `WindowEvent::Focused(false)` hides it — unless
  `PopoverPinned` is set (the settings view pins it so editing fields doesn't
  dismiss it).
- Commands: `hide_popover`, `quit_app`, `set_recording` (RecordingFlag atomic
  so the tray knows whether to stop vs toggle), `set_popover_pinned`.
- Clicking a workflow row hides the popover then records in toggle mode (focus
  returns to the prior app so paste lands there); a tray click stops it.
- Icons via `tauri icon` from the macOS app icon; tray uses the monochrome
  `icons/tray.png` (template). Light + dark via `prefers-color-scheme`.
- **Icons:** app icons regenerated from the macOS app icon via `tauri icon`
  (`BlitztextMac/Resources/.../icon_1024x1024.png`). The tray uses the monochrome
  menu-bar glyph (`icons/tray.png`, copied from `menubar_icon@2x.png`),
  embedded via `include_bytes!` + `Image::from_bytes` (tauri `image-png`
  feature) with `icon_as_template(true)` so macOS tints it.
- **Light + dark mode:** both `index.html` and `settings.html` define their
  palette as CSS variables with a `@media (prefers-color-scheme: light)`
  override, matching the macOS app's light/dark popover.

## Open follow-ups (post-M1)

- Hotkey capture vs. an active global shortcut: while recording a new combo, the
  OS may swallow the keystroke if it equals a registered hotkey. Acceptable for
  now; could unregister during capture.
- Verlauf / request-history tab (Mac has it; needs request logging).
- OpenAI direct provider is not wired in Rust yet (gateway is the supported
  path); the OpenAI key field stores a secret but requests still target liteLLM.
- Window naming/product polish ("blitztextwin").

M2 (parity/polish): four workflows, settings + request-history UI, NSIS installer,
Windows Authenticode signing, optional auto-update; add `windows-release.yml`
(Windows runner) and `paths:` filters on `macos-release.yml` so each app only
builds when its files change.

M3 (nice-to-have): local transcription via whisper.cpp / `whisper-rs` on both
platforms (would also dodge the macOS Intel WhisperKit crash — see memory).

## How to run (dev, on the Mac)

```bash
cd BlitztextWin
npm install
npm run tauri dev
```

Toolchain present on the dev machine: Homebrew Rust 1.95 (no rustup needed),
Node 22 / npm 10. Tauri identifier is `app.blitztext.win`; window/product naming
("blitztextwin") still to polish.

## Related memory (auto-loaded)

- `provider-switch-litellm` — the macOS app's OpenAI/LiteLLM provider switch and
  the two gateway gotchas.
- `intel-progressview-coreui-crash` — macOS Intel crashes: the `ProgressView`
  spinner crash (fixed) and the local WhisperKit/CoreML crash (use the gateway).
