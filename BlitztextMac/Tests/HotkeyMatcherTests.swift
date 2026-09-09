import XCTest

final class HotkeyMatcherTests: XCTestCase {
    private let matcher = HotkeyMatcher(bindings: HotkeyBindings())

    func testKombinationOhnePraefixKonfliktFeuertSofort() {
        // fn + Cmd ist in keiner anderen vergebenen Kombination enthalten.
        XCTAssertEqual(matcher.decision(for: HotkeyCombo(.fn, .command), active: nil), .fire(.emojiText))
    }

    func testPraefixKombinationWartet() {
        // fn + Shift steckt in fn + Shift + Ctrl und fn + Shift + Option.
        XCTAssertEqual(
            matcher.decision(for: HotkeyCombo(.fn, .shift), active: nil),
            .delayed(.transcription, delay: 0.15)
        )
        XCTAssertTrue(matcher.isPrefixOfOtherAssignment(HotkeyCombo(.fn, .shift)))
    }

    func testLaengereKombinationFeuertSofort() {
        XCTAssertEqual(
            matcher.decision(for: HotkeyCombo(.fn, .shift, .option), active: nil),
            .fire(.vaultDictation)
        )
        XCTAssertFalse(matcher.isPrefixOfOtherAssignment(HotkeyCombo(.fn, .shift, .option)))
    }

    func testLoslassenLiefertRelease() {
        XCTAssertEqual(matcher.decision(for: HotkeyCombo([]), active: .transcription), .release(.transcription))
        XCTAssertEqual(matcher.decision(for: HotkeyCombo(.fn), active: .transcription), .release(.transcription))
    }

    func testUnbelegteKombinationTutNichts() {
        XCTAssertEqual(matcher.decision(for: HotkeyCombo(.shift, .command), active: nil), .none)
        XCTAssertEqual(matcher.decision(for: HotkeyCombo([]), active: nil), .none)
    }

    func testWeitereModifierWaehrendEinerAufnahmeAendernNichts() {
        // Wie im Bestand: laeuft schon eine Aufnahme, wird eine andere
        // Kombination ignoriert statt die laufende zu beenden.
        XCTAssertEqual(matcher.decision(for: HotkeyCombo(.fn, .shift, .option), active: .transcription), .none)
        XCTAssertEqual(matcher.decision(for: HotkeyCombo(.fn, .shift), active: .transcription), .none)
    }

    func testEigeneKuerzelWerdenBeachtet() {
        var bindings = HotkeyBindings()
        bindings.set(HotkeyCombo(.control, .option), for: .transcription)
        let eigener = HotkeyMatcher(bindings: bindings)

        XCTAssertEqual(eigener.decision(for: HotkeyCombo(.control, .option), active: nil), .fire(.transcription))
        // fn + Shift ist jetzt nicht mehr vergeben.
        XCTAssertEqual(eigener.decision(for: HotkeyCombo(.fn, .shift), active: nil), .none)
        // fn + Shift + Option bleibt vergeben und hat keinen Praefix-Konflikt.
        XCTAssertEqual(eigener.decision(for: HotkeyCombo(.fn, .shift, .option), active: nil), .fire(.vaultDictation))
    }

    func testWartezeitIstEineFesteGroesse() {
        XCTAssertEqual(HotkeyMatcher.prefixDelay, 0.15, accuracy: 0.0001)
    }
}
