# Blitztext for Windows (preview)

The Windows companion to the macOS Blitztext app. Same idea — press a hotkey,
speak, get text back, optionally rewrite it, and paste it into the app you were
using — built as a separate, cross-platform app because almost nothing can be
shared between the native Swift macOS app and the Windows stack.

**Stack:** [Tauri v2](https://v2.tauri.app/) (Rust core) + TypeScript/HTML UI.

> Preview / work in progress. See [HANDOFF.md](HANDOFF.md) for the detailed,
> up-to-date status and design notes.

## What it does

- **Blitztext** — record speech and transcribe it.
- **Blitztext+** — transcribe, then clean up the rough draft.
- **Blitztext $%&!** — turn a frustrated rant into a calm message.
- **Blitztext :)** — add fitting emojis to dictated text.

It lives in the system tray as a small popover (menu + settings), records via a
global push-to-talk (or toggle) hotkey per workflow, transcribes/rewrites
through the gateway, and pastes the result into the active app.

## Provider

This app targets a **LiteLLM gateway** (plain-HTTP OpenAI-compatible proxy) as
the supported path. The gateway URL and API key are configured in the app; the
key is stored in the OS credential store (macOS Keychain / Windows Credential
Manager), never in the web layer. A direct OpenAI provider is stubbed in the UI
but not yet wired in the backend.

System prompts for the rewrite workflows come from
[`../shared/prompts.json`](../shared/prompts.json), the single source shared
with the macOS app.

## Requirements

- [Node.js](https://nodejs.org/) 22+ and npm
- [Rust](https://www.rust-lang.org/tools/install) (stable) for the Tauri core
- Platform toolchain per the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
  (on Windows: the WebView2 runtime, already present on Windows 10/11)

## Develop

```bash
cd BlitztextWin
npm install
npm run tauri dev
```

The app starts in the tray (no window). Click the tray icon for the popover;
the gear opens settings. Configure the gateway URL + key under **Zugang**, then
hold a workflow hotkey (default `Win+Shift+D` / on macOS `Cmd+Shift+D`) to dictate.

## Build installers

```bash
cd BlitztextWin
npm run tauri build
```

Produces unsigned NSIS (`.exe`) and MSI installers under
`src-tauri/target/release/bundle/`. CI builds these automatically — see the root
[README](../README.md#continuous-builds-and-releases).

## Layout

```text
BlitztextWin/
  index.html        Tray popover (menu + settings views), dark/light themed
  src/
    popover.ts      Popover UI, dictation pipeline, hotkeys, settings wiring
    config.ts       Settings model + secure-key helpers
    prompts.ts      System-prompt assembly from shared/prompts.json
  src-tauri/
    src/lib.rs      Rust commands: keyring, gateway, transcribe, chat,
                    hotkeys, paste, tray, autostart, window/positioning
    tauri.conf.json App + window config
```
