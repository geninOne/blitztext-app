use std::collections::HashMap;
use tauri_plugin_global_shortcut::Shortcut;

/// Ordnet jedem registrierten globalen Kuerzel die ID seines Modus zu, damit der
/// gemeinsame Handler weiss, welchen Modus er melden soll, und Kuerzel zur
/// Laufzeit neu belegt werden koennen. Ein Modus hat hoechstens ein Kuerzel, ein
/// Kuerzel gehoert hoechstens einem Modus. Die Windows-Taste uebernimmt die Rolle,
/// die `fn` in der macOS-App spielt. Der Mutex darum liegt in `lib.rs`.
#[derive(Default)]
pub struct HotkeyMap {
    shortcuts: HashMap<Shortcut, String>,
}

impl HotkeyMap {
    /// Alle Kuerzel, die frei werden, wenn `mode_id` das Kuerzel `shortcut`
    /// bekommt: die bisherige Belegung des Modus und eine fremde Belegung
    /// desselben Kuerzels. Die Map bleibt unveraendert.
    pub fn freed_by(&self, mode_id: &str, shortcut: &Shortcut) -> Vec<Shortcut> {
        self.shortcuts
            .iter()
            .filter(|(s, m)| m.as_str() == mode_id || *s == shortcut)
            .map(|(s, _)| *s)
            .collect()
    }

    /// Belegt `shortcut` fuer `mode_id` und raeumt dabei die alte Belegung des
    /// Modus und eine fremde Belegung desselben Kuerzels weg.
    pub fn assign(&mut self, mode_id: &str, shortcut: Shortcut) {
        for s in self.freed_by(mode_id, &shortcut) {
            self.shortcuts.remove(&s);
        }
        self.shortcuts.insert(shortcut, mode_id.to_string());
    }

    /// Entfernt das Kuerzel des Modus und gibt es zurueck, damit es abgemeldet
    /// werden kann. `None`, wenn der Modus keins hatte.
    pub fn clear(&mut self, mode_id: &str) -> Option<Shortcut> {
        let shortcut = self
            .shortcuts
            .iter()
            .find(|(_, m)| m.as_str() == mode_id)
            .map(|(s, _)| *s)?;
        self.shortcuts.remove(&shortcut);
        Some(shortcut)
    }

    /// Die Modus-ID, der das Kuerzel gehoert.
    pub fn mode_for(&self, shortcut: &Shortcut) -> Option<&str> {
        self.shortcuts.get(shortcut).map(String::as_str)
    }
}


#[cfg(test)]
mod tests {
    use super::HotkeyMap;
    use std::str::FromStr;
    use tauri_plugin_global_shortcut::Shortcut;

    fn sc(s: &str) -> Shortcut {
        Shortcut::from_str(s).unwrap()
    }

    #[test]
    fn zweiter_modus_mit_gleichem_kuerzel_verdraengt_den_ersten() {
        let x = sc("Super+Shift+KeyD");
        let mut map = HotkeyMap::default();
        map.assign("a", x);
        assert_eq!(map.freed_by("b", &x), vec![x]);
        map.assign("b", x);
        assert_eq!(map.mode_for(&x), Some("b"));
        // a hat kein Kuerzel mehr
        assert_eq!(map.clear("a"), None);
    }

    #[test]
    fn neues_kuerzel_gibt_das_alte_des_modus_frei() {
        let (x, y) = (sc("Super+Shift+KeyD"), sc("Super+Shift+KeyE"));
        let mut map = HotkeyMap::default();
        map.assign("a", x);
        assert_eq!(map.freed_by("a", &y), vec![x]);
        map.assign("a", y);
        assert_eq!(map.mode_for(&x), None);
        assert_eq!(map.mode_for(&y), Some("a"));
    }

    #[test]
    fn beide_belegungen_werden_frei() {
        let (x, y) = (sc("Super+Shift+KeyD"), sc("Super+Shift+KeyE"));
        let mut map = HotkeyMap::default();
        map.assign("a", x);
        map.assign("b", y);
        let freed = map.freed_by("a", &y);
        assert_eq!(freed.len(), 2);
        assert!(freed.contains(&x) && freed.contains(&y));
    }

    #[test]
    fn freed_by_aendert_nichts() {
        let (x, y) = (sc("Super+Shift+KeyD"), sc("Super+Shift+KeyE"));
        let mut map = HotkeyMap::default();
        map.assign("a", x);
        map.assign("b", y);
        let _ = map.freed_by("a", &y);
        assert_eq!(map.mode_for(&x), Some("a"));
        assert_eq!(map.mode_for(&y), Some("b"));
    }

    #[test]
    fn geloeschter_modus_gibt_sein_kuerzel_frei() {
        let x = sc("Super+Shift+KeyD");
        let mut map = HotkeyMap::default();
        map.assign("a", x);
        assert_eq!(map.clear("a"), Some(x));
        assert_eq!(map.mode_for(&x), None);
        assert_eq!(map.clear("a"), None);
    }
}
