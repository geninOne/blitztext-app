use std::io::Write;
use std::path::{Path, PathBuf};

/// Normalizes a user-entered gateway URL to the bare base, so we can append the
/// API paths ourselves. Strips a trailing slash and any trailing `/v1` or `/ui`
/// segments (in any order) — people often paste the LiteLLM web UI URL
/// (".../ui") or an OpenAI-style ".../v1" base.
pub fn normalize_base(base: &str) -> String {
    let mut value = base.trim().trim_end_matches('/').to_string();
    loop {
        let lower = value.to_lowercase();
        if lower.ends_with("/v1") || lower.ends_with("/ui") {
            value.truncate(value.len() - 3);
            value = value.trim_end_matches('/').to_string();
        } else {
            break;
        }
    }
    value
}

/// Liest die Einstellungsdatei als JSON-Text. Fehlt die Datei, ist sie
/// unlesbar oder kein gueltiges JSON-Objekt, kommt "{}" zurueck: die Oberflaeche
/// legt dann die Standardwerte darueber, statt mit leerem Zustand zu starten.
pub fn read_settings_file(path: &Path) -> String {
    let Ok(text) = std::fs::read_to_string(path) else {
        return "{}".to_string();
    };
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(serde_json::Value::Object(_)) => text,
        _ => "{}".to_string(),
    }
}

/// Schreibt die Einstellungsdatei ueber eine Nebendatei "<path>.neu" und
/// benennt sie danach um. Bricht das Schreiben mittendrin ab, bleibt die alte
/// Datei heil. Fehlt das Verzeichnis (erster Start), wird es angelegt.
pub fn write_settings_file(path: &Path, json: &str) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut neu = path.as_os_str().to_owned();
    neu.push(".neu");
    let neu = PathBuf::from(neu);
    {
        let mut datei = std::fs::File::create(&neu)?;
        datei.write_all(json.as_bytes())?;
        datei.sync_all()?;
    }
    std::fs::rename(&neu, path)
}

#[cfg(test)]
mod tests {
    use super::{normalize_base, read_settings_file, write_settings_file};
    use std::path::PathBuf;

    // Eigenes Verzeichnis je Test unter dem System-Temp, damit parallele Tests
    // sich nicht in die Quere kommen.
    fn testverzeichnis(name: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join(format!("blitztext-settings-test-{}-{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn beschaedigte_datei_liefert_leeres_objekt() {
        let dir = testverzeichnis("kaputt");
        let path = dir.join("settings.json");
        std::fs::write(&path, "{ kaputt").unwrap();
        assert_eq!(read_settings_file(&path), "{}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fehlende_datei_liefert_leeres_objekt() {
        let dir = testverzeichnis("fehlt");
        assert_eq!(read_settings_file(&dir.join("settings.json")), "{}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn gueltige_datei_kommt_unveraendert_zurueck() {
        let dir = testverzeichnis("gueltig");
        let path = dir.join("settings.json");
        std::fs::write(&path, r#"{"hotkeyMode":"toggle"}"#).unwrap();
        assert_eq!(read_settings_file(&path), r#"{"hotkeyMode":"toggle"}"#);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn schreiben_ersetzt_atomar() {
        let dir = testverzeichnis("atomar");
        let path = dir.join("settings.json");
        write_settings_file(&path, r#"{"a":1}"#).unwrap();
        write_settings_file(&path, r#"{"a":2}"#).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), r#"{"a":2}"#);
        assert!(!dir.join("settings.json.neu").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn schreiben_legt_fehlendes_verzeichnis_an() {
        let dir = testverzeichnis("neuverz");
        let path = dir.join("unter").join("settings.json");
        write_settings_file(&path, "{}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn entfernt_v1_und_schraegstrich() {
        assert_eq!(normalize_base("http://host:4000/v1/"), "http://host:4000");
    }

    #[test]
    fn laesst_adresse_ohne_v1_unveraendert() {
        assert_eq!(normalize_base("http://host:4000"), "http://host:4000");
    }

    #[test]
    fn entfernt_mehrere_schraegstriche() {
        assert_eq!(normalize_base("http://host:4000///"), "http://host:4000");
        assert_eq!(normalize_base("http://host:4000/v1//"), "http://host:4000");
    }

    #[test]
    fn entfernt_auch_ui() {
        assert_eq!(normalize_base("http://host:4000/ui/"), "http://host:4000");
    }

    #[test]
    fn ignoriert_gross_und_kleinschreibung() {
        assert_eq!(normalize_base("http://host:4000/V1"), "http://host:4000");
    }

    #[test]
    fn entfernt_mehrere_segmente_hintereinander() {
        assert_eq!(normalize_base("http://host:4000/v1/ui"), "http://host:4000");
    }
}
