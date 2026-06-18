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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            secret_set,
            secret_get,
            secret_has,
            gateway_test
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
