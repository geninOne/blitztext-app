// Sprache der Anweisungen fuer eigene Modi, wie PromptLanguage.swift auf dem
// Mac: die erkannte Hauptsprache ohne Verlaesslichkeitsschwelle, Englisch nur,
// wenn sie Englisch ist. Erkannt wird nur zwischen Deutsch und Englisch; wird
// gar nichts erkannt (etwa bei leerem Text), gilt Deutsch.
use whatlang::{Detector, Lang};

/// "en", wenn Englisch die erkannte Sprache ist, sonst "de".
pub fn detect(text: &str) -> &'static str {
    let detector = Detector::with_allowlist(vec![Lang::Deu, Lang::Eng]);
    match detector.detect_lang(text) {
        Some(Lang::Eng) => "en",
        _ => "de",
    }
}

#[cfg(test)]
mod tests {
    use super::detect;

    #[test]
    fn leerer_text_ist_deutsch() {
        assert_eq!(detect(""), "de");
        assert_eq!(detect("   "), "de");
    }

    #[test]
    fn kurzes_englisch_ist_englisch() {
        assert_eq!(detect("Can we meet on Thursday at ten?"), "en");
    }

    #[test]
    fn kurzes_deutsch_ist_deutsch() {
        assert_eq!(detect("Ich ruf dich morgen an."), "de");
    }

    #[test]
    fn lange_saetze_folgen_ihrer_sprache() {
        assert_eq!(
            detect("Could you please send me the report by Thursday, because I need it for the meeting with the whole team next week."),
            "en"
        );
        assert_eq!(
            detect("Kannst du mir bitte den Bericht bis Donnerstag schicken, weil ich ihn für das Treffen mit dem ganzen Team nächste Woche brauche."),
            "de"
        );
    }
}
