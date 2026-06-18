# shared/

Single source of truth for the small, platform-agnostic pieces that both apps
(the macOS Swift app in `BlitztextMac/` and the Windows Tauri app in
`BlitztextWin/`) must keep in sync.

Most of each app is platform-specific (UI, audio, hotkeys, paste, tray) and
lives in the app folders. Only the following overlap, so they are defined once
here and ported/loaded by each app:

- `prompts.json` — the system prompts and their dynamic parts (tones, emoji
  density, vocabulary hints).
- `gateway-contract.md` — the OpenAI-compatible request/response contract used
  for transcription and chat, including two gateway-specific gotchas.
- `config-schema.json` — the provider/model configuration shape.

When you change a prompt or the config shape, change it here and mirror it into
both apps in the same pull request.
