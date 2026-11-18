// Sprache der Anweisungen fuer eigene Modi, wie PromptLanguage.swift auf dem
// Mac: Englisch nur, wenn die Erkennung sicher Englisch sagt, sonst Deutsch.
// Kurze oder gemischte Diktate bleiben so deutsch, wie die meisten Diktate.

use whatlang::Lang;

/// "en" nur bei sicher erkanntem Englisch, sonst "de".
pub fn detect(text: &str) -> &'static str {
    match whatlang::detect(text) {
        Some(info) if info.lang() == Lang::Eng && info.is_reliable() => "en",
        _ => "de",
    }
}

#[cfg(test)]
mod tests {
    use super::detect;

    #[test]
    fn leerer_oder_sehr_kurzer_text_ist_deutsch() {
        assert_eq!(detect(""), "de");
        assert_eq!(detect("   "), "de");
        assert_eq!(detect("ok"), "de");
        assert_eq!(detect("Hi"), "de");
    }

    #[test]
    fn sicheres_englisch_ist_englisch() {
        assert_eq!(
            detect("Could you please send me the report by Thursday, because I need it for the meeting with the whole team next week."),
            "en"
        );
    }

    #[test]
    fn deutsch_bleibt_deutsch() {
        assert_eq!(
            detect("Kannst du mir bitte den Bericht bis Donnerstag schicken, weil ich ihn für das Treffen mit dem ganzen Team nächste Woche brauche."),
            "de"
        );
    }

    #[test]
    fn andere_sprachen_gelten_als_deutsch() {
        assert_eq!(
            detect("Pourriez-vous m'envoyer le rapport avant jeudi, car j'en ai besoin pour la réunion avec toute l'équipe la semaine prochaine."),
            "de"
        );
    }
}
