// Secret storage backed by the OS credential store
// (macOS Keychain via apple-native, Windows Credential Manager via windows-native).
const KEYRING_SERVICE: &str = "app.blitztext.win";
const LITELLM_KEY_ACCOUNT: &str = "liteLLMApiKey";

#[tauri::command]
fn secret_set(account: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &account).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_get(account: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &account).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secret_has(account: String) -> Result<bool, String> {
    Ok(secret_get(account)?.is_some())
}

// --- Gateway client ---------------------------------------------------------

fn litellm_key() -> Result<String, String> {
    secret_get(LITELLM_KEY_ACCOUNT.to_string())?
        .ok_or_else(|| "Kein API-Key gespeichert.".to_string())
}

/// Trims a trailing slash and a trailing `/v1` so we can append the API paths
/// ourselves.
fn normalize_base(base: &str) -> String {
    let mut value = base.trim().trim_end_matches('/').to_string();
    if value.to_lowercase().ends_with("/v1") {
        value.truncate(value.len() - 3);
        value = value.trim_end_matches('/').to_string();
    }
    value
}

/// Lists the models the gateway exposes. Used by the "test connection" button
/// to confirm the URL, key and reachability in one shot.
#[tauri::command]
async fn gateway_test(base_url: String) -> Result<Vec<String>, String> {
    let key = litellm_key()?;
    let url = format!("{}/v1/models", normalize_base(&base_url));

    let response = reqwest::Client::new()
        .get(&url)
        .bearer_auth(key)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status.as_u16(), body));
    }

    let parsed: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let ids = parsed["data"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(ids)
}

/// Transcribes recorded audio via the gateway. Audio is passed from the webview
/// as base64. The gateway may return JSON even for response_format=text, so we
/// parse defensively (prefer a top-level `text` field, fall back to raw body).
#[tauri::command]
async fn transcribe(
    base_url: String,
    model: String,
    language: Option<String>,
    audio_base64: String,
    filename: Option<String>,
    content_type: Option<String>,
) -> Result<String, String> {
    use base64::Engine as _;

    let key = litellm_key()?;
    let url = format!("{}/v1/audio/transcriptions", normalize_base(&base_url));
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(audio_base64.as_bytes())
        .map_err(|e| e.to_string())?;

    let mime = content_type.unwrap_or_else(|| "application/octet-stream".to_string());
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(filename.unwrap_or_else(|| "audio.webm".to_string()))
        .mime_str(&mime)
        .map_err(|e| e.to_string())?;
    let mut form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", model)
        .text("response_format", "text");
    if let Some(lang) = language {
        let lang = lang.trim().to_string();
        if !lang.is_empty() {
            form = form.text("language", lang);
        }
    }

    let response = reqwest::Client::new()
        .post(&url)
        .bearer_auth(key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status.as_u16(), body));
    }

    let transcript = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|v| v["text"].as_str().map(|s| s.to_string()))
        .unwrap_or(body);
    Ok(transcript.trim().to_string())
}

// --- Paste into the active app ---------------------------------------------

/// Puts `text` on the clipboard and simulates the paste shortcut so it lands in
/// whatever app currently has focus (our window stays hidden in the tray).
/// macOS needs Accessibility permission for the synthetic keystroke; Windows
/// needs no prompt.
#[tauri::command]
fn paste_text(text: String) -> Result<(), String> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};

    if text.is_empty() {
        return Ok(());
    }

    arboard::Clipboard::new()
        .and_then(|mut cb| cb.set_text(text))
        .map_err(|e| format!("Zwischenablage: {e}"))?;

    // Let the clipboard write settle before pasting.
    std::thread::sleep(std::time::Duration::from_millis(80));

    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| format!("Eingabe-Simulation nicht verfuegbar: {e}"))?;
    #[cfg(target_os = "macos")]
    let modifier = Key::Meta;
    #[cfg(not(target_os = "macos"))]
    let modifier = Key::Control;

    let paste = |enigo: &mut Enigo| -> Result<(), enigo::InputError> {
        enigo.key(modifier, Direction::Press)?;
        enigo.key(Key::Unicode('v'), Direction::Click)?;
        enigo.key(modifier, Direction::Release)?;
        Ok(())
    };
    paste(&mut enigo).map_err(|e| format!("Einfuegen fehlgeschlagen: {e}"))?;
    Ok(())
}

// --- Push-to-talk global hotkeys -------------------------------------------

/// Maps each currently registered global shortcut to its workflow id, so the
/// shared handler knows which workflow to emit and so hotkeys can be rebound at
/// runtime. The Windows/Super key plays the role `fn` plays on the macOS app.
#[derive(Default)]
struct HotkeyMap(std::sync::Mutex<std::collections::HashMap<tauri_plugin_global_shortcut::Shortcut, String>>);

/// Rebinds the global hotkey for a workflow. Accepts an accelerator string
/// (e.g. "Super+Shift+KeyD"); a real key is required because modifier-only
/// combos cannot be registered as global shortcuts on Windows. Frees both the
/// workflow's previous combo and any combo another workflow already holds, so
/// bindings can never collide or leak.
#[tauri::command]
fn set_hotkey(
    app: tauri::AppHandle,
    state: tauri::State<'_, HotkeyMap>,
    workflow: String,
    accelerator: String,
) -> Result<(), String> {
    use std::str::FromStr;
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

    let shortcut =
        Shortcut::from_str(accelerator.trim()).map_err(|e| format!("Ungueltiger Hotkey: {e}"))?;
    let gs = app.global_shortcut();
    let mut map = state.0.lock().map_err(|e| e.to_string())?;

    // Release the workflow's old combo and any combo another workflow held.
    let stale: Vec<Shortcut> = map
        .iter()
        .filter(|(s, w)| **w == workflow || **s == shortcut)
        .map(|(s, _)| *s)
        .collect();
    for s in stale {
        let _ = gs.unregister(s);
        map.remove(&s);
    }

    gs.register(shortcut)
        .map_err(|e| format!("Hotkey konnte nicht registriert werden: {e}"))?;
    map.insert(shortcut, workflow);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::{Emitter, Manager};
    use tauri_plugin_global_shortcut::ShortcutState;

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            // Hold-to-talk: the plugin reports both Pressed and Released, so we
            // emit a down/up pair the webview turns into start/stop recording.
            // The workflow id is looked up from the runtime HotkeyMap.
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    let workflow = app
                        .state::<HotkeyMap>()
                        .0
                        .lock()
                        .ok()
                        .and_then(|map| map.get(shortcut).cloned());
                    if let Some(workflow) = workflow {
                        let _ = match event.state() {
                            ShortcutState::Pressed => app.emit("hotkey-down", workflow),
                            ShortcutState::Released => app.emit("hotkey-up", workflow),
                        };
                    }
                })
                .build(),
        )
        .manage(HotkeyMap::default())
        .invoke_handler(tauri::generate_handler![
            secret_set,
            secret_get,
            secret_has,
            gateway_test,
            transcribe,
            set_hotkey,
            paste_text
        ])
        .on_window_event(|window, event| {
            // Closing the window only hides it; the app keeps running in the
            // tray so the global hotkey stays alive. "Beenden" in the tray menu
            // is the real quit.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .setup(|app| {
            // Hotkeys themselves are registered by the frontend from saved
            // settings via `set_hotkey` once the webview loads.
            build_tray(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// System-tray icon with a minimal menu (show window / quit). Lets the app keep
/// running in the background so the global hotkey works while the window is
/// hidden.
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;
    use tauri::Manager;

    let show = MenuItem::with_id(app, "show", "Fenster anzeigen", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Blitztext — Win+Shift+D halten zum Diktieren")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}
