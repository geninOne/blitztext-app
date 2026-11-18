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

/// Ergebnis beim Lesen der Einstellungsdatei. `Missing` und `Corrupt` fuehren
/// zur Uebernahme aus dem localStorage (eine kaputte Datei ist vorher
/// gesichert); bei `Unreadable` darf die Oberflaeche in dieser Sitzung nicht
/// speichern, damit eine nur kurz gesperrte Datei (Virenscanner, OneDrive)
/// nicht ueberschrieben wird.
#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum SettingsRead {
    /// Keine Datei vorhanden (erster Start).
    Missing,
    /// Gueltiges JSON-Objekt, als Text.
    Ok { json: String },
    /// Lesbar, aber kein gueltiges JSON-Objekt; liegt gesichert als
    /// "<path>.defekt" daneben.
    Corrupt,
    /// Vorhanden, aber nicht lesbar (jeder andere I/O-Fehler).
    Unreadable,
}

/// Liest die Einstellungsdatei und unterscheidet fehlend, gueltig, kaputt und
/// unlesbar. Ein fuehrendes UTF-8-BOM (so speichert etwa der Windows-Editor)
/// wird entfernt, die Datei gilt dann als gueltig. Eine kaputte Datei wird
/// vorher nach "<path>.defekt" kopiert (eine fruehere Sicherung wird ersetzt).
/// Scheitert diese Sicherung, gilt die Datei als unlesbar, damit sie nicht
/// ungesichert ueberschrieben wird.
pub fn read_settings_file(path: &Path) -> SettingsRead {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return SettingsRead::Missing,
        Err(_) => return SettingsRead::Unreadable,
    };
    if let Ok(text) = String::from_utf8(bytes) {
        let text = match text.strip_prefix('\u{FEFF}') {
            Some(ohne_bom) => ohne_bom.to_string(),
            None => text,
        };
        if let Ok(serde_json::Value::Object(_)) = serde_json::from_str::<serde_json::Value>(&text) {
            return SettingsRead::Ok { json: text };
        }
    }
    match std::fs::copy(path, nebendatei(path, ".defekt")) {
        Ok(_) => SettingsRead::Corrupt,
        Err(_) => SettingsRead::Unreadable,
    }
}

fn nebendatei(path: &Path, endung: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(endung);
    PathBuf::from(name)
}

/// Schreibt die Einstellungsdatei ueber eine Nebendatei "<path>.neu" und
/// benennt sie danach um. Bricht das Schreiben mittendrin ab, bleibt die alte
/// Datei heil. Fehlt das Verzeichnis (erster Start), wird es angelegt.
pub fn write_settings_file(path: &Path, json: &str) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let neu = nebendatei(path, ".neu");
    {
        let mut datei = std::fs::File::create(&neu)?;
        datei.write_all(json.as_bytes())?;
        datei.sync_all()?;
    }
    std::fs::rename(&neu, path)
}

#[cfg(test)]
mod tests {
    use super::{normalize_base, read_settings_file, write_settings_file, SettingsRead};
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
    fn beschaedigte_datei_wird_gesichert_und_als_kaputt_gemeldet() {
        let dir = testverzeichnis("kaputt");
        let path = dir.join("settings.json");
        let sicherung = dir.join("settings.json.defekt");
        std::fs::write(&sicherung, "alte Sicherung").unwrap();
        std::fs::write(&path, "{ kaputt").unwrap();
        assert_eq!(read_settings_file(&path), SettingsRead::Corrupt);
        assert_eq!(std::fs::read_to_string(&sicherung).unwrap(), "{ kaputt");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn json_ohne_objekt_gilt_als_kaputt() {
        let dir = testverzeichnis("keinobjekt");
        let path = dir.join("settings.json");
        std::fs::write(&path, "[1, 2]").unwrap();
        assert_eq!(read_settings_file(&path), SettingsRead::Corrupt);
        assert!(dir.join("settings.json.defekt").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn gesperrte_datei_ist_unlesbar_und_bleibt_unveraendert() {
        use std::os::unix::fs::PermissionsExt;
        let dir = testverzeichnis("gesperrt");
        let path = dir.join("settings.json");
        std::fs::write(&path, r#"{"hotkeyMode":"toggle"}"#).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).unwrap();
        // Als root greifen die Rechte nicht; dann laesst sich der Fall hier
        // nicht nachstellen.
        if std::fs::read(&path).is_ok() {
            let _ = std::fs::remove_dir_all(&dir);
            return;
        }
        let ergebnis = read_settings_file(&path);
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(ergebnis, SettingsRead::Unreadable);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), r#"{"hotkeyMode":"toggle"}"#);
        assert!(!dir.join("settings.json.defekt").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn status_wird_fuer_die_oberflaeche_serialisiert() {
        assert_eq!(
            serde_json::to_string(&SettingsRead::Ok { json: "{}".into() }).unwrap(),
            r#"{"status":"ok","json":"{}"}"#
        );
        assert_eq!(
            serde_json::to_string(&SettingsRead::Unreadable).unwrap(),
            r#"{"status":"unreadable"}"#
        );
    }

    #[test]
    fn fuehrendes_bom_wird_entfernt_und_die_datei_gilt_als_gueltig() {
        // Der Windows-Editor speichert UTF-8 gern mit Byte-Order-Mark.
        let dir = testverzeichnis("bom");
        let path = dir.join("settings.json");
        std::fs::write(&path, "\u{FEFF}{\"hotkeyMode\":\"toggle\"}").unwrap();
        assert_eq!(
            read_settings_file(&path),
            SettingsRead::Ok { json: r#"{"hotkeyMode":"toggle"}"#.to_string() }
        );
        assert!(!dir.join("settings.json.defekt").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fehlende_datei_wird_als_fehlend_gemeldet() {
        let dir = testverzeichnis("fehlt");
        assert_eq!(read_settings_file(&dir.join("settings.json")), SettingsRead::Missing);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn gueltige_datei_kommt_unveraendert_zurueck() {
        let dir = testverzeichnis("gueltig");
        let path = dir.join("settings.json");
        std::fs::write(&path, r#"{"hotkeyMode":"toggle"}"#).unwrap();
        assert_eq!(
            read_settings_file(&path),
            SettingsRead::Ok { json: r#"{"hotkeyMode":"toggle"}"#.to_string() }
        );
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
