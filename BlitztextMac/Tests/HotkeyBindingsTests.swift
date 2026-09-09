import XCTest
import AppKit

final class HotkeyBindingsTests: XCTestCase {
    func testStandardKombinationenSindGueltigUndKonfliktfrei() {
        var gesehen: Set<HotkeyCombo> = []
        for typ in WorkflowType.allCases {
            let kombination = HotkeyBindings.defaultCombo(for: typ)
            XCTAssertGreaterThanOrEqual(
                kombination.modifiers.count,
                2,
                "\(typ.rawValue) braucht mindestens zwei Modifier"
            )
            XCTAssertTrue(
                gesehen.insert(kombination).inserted,
                "\(typ.rawValue) belegt eine bereits vergebene Kombination"
            )
        }
    }

    func testStandardEntsprichtDenBisherigenKuerzeln() {
        XCTAssertEqual(HotkeyBindings.defaultCombo(for: .transcription), HotkeyCombo(.fn, .shift))
        XCTAssertEqual(HotkeyBindings.defaultCombo(for: .localTranscription), HotkeyCombo(.fn, .shift, .control))
        XCTAssertEqual(HotkeyBindings.defaultCombo(for: .vaultDictation), HotkeyCombo(.fn, .shift, .option))
        XCTAssertEqual(HotkeyBindings.defaultCombo(for: .textImprover), HotkeyCombo(.fn, .control))
        XCTAssertEqual(HotkeyBindings.defaultCombo(for: .dampfAblassen), HotkeyCombo(.fn, .option))
        XCTAssertEqual(HotkeyBindings.defaultCombo(for: .emojiText), HotkeyCombo(.fn, .command))
    }

    func testSetzenUndEinzelnZuruecksetzen() {
        var bindings = HotkeyBindings()
        XCTAssertFalse(bindings.hasOverrides)

        bindings.set(HotkeyCombo(.control, .option), for: .transcription)
        XCTAssertEqual(bindings.combo(for: .transcription), HotkeyCombo(.control, .option))
        XCTAssertFalse(bindings.isDefault(for: .transcription))
        XCTAssertTrue(bindings.hasOverrides)

        bindings.reset(.transcription)
        XCTAssertEqual(bindings.combo(for: .transcription), HotkeyBindings.defaultCombo(for: .transcription))
        XCTAssertTrue(bindings.isDefault(for: .transcription))
        XCTAssertFalse(bindings.hasOverrides)
    }

    func testAllesZuruecksetzen() {
        var bindings = HotkeyBindings()
        bindings.set(HotkeyCombo(.control, .option), for: .transcription)
        bindings.set(HotkeyCombo(.control, .command), for: .emojiText)
        XCTAssertTrue(bindings.hasOverrides)

        bindings.resetAll()
        XCTAssertFalse(bindings.hasOverrides)
        for typ in WorkflowType.allCases {
            XCTAssertEqual(bindings.combo(for: typ), HotkeyBindings.defaultCombo(for: typ))
        }
    }

    func testDasSetzenDesStandardsIstKeineAbweichung() {
        var bindings = HotkeyBindings()
        bindings.set(HotkeyBindings.defaultCombo(for: .emojiText), for: .emojiText)
        XCTAssertFalse(bindings.hasOverrides)
    }

    func testEinzelnerModifierWirdAbgelehnt() {
        let bindings = HotkeyBindings()
        XCTAssertEqual(bindings.validate(HotkeyCombo(.fn), for: .transcription), .tooFewModifiers)
        XCTAssertEqual(bindings.validate(HotkeyCombo(.shift), for: .transcription), .tooFewModifiers)
        XCTAssertEqual(bindings.validate(HotkeyCombo([]), for: .transcription), .tooFewModifiers)
    }

    func testBelegteKombinationWirdMitBesitzerAbgelehnt() {
        let bindings = HotkeyBindings()
        XCTAssertEqual(
            bindings.validate(HotkeyCombo(.fn, .option), for: .transcription),
            .alreadyUsed(by: .dampfAblassen)
        )
        XCTAssertEqual(bindings.owner(of: HotkeyCombo(.fn, .option), excluding: .transcription), .dampfAblassen)
    }

    func testEigeneUnveraenderteKombinationBleibtErlaubt() {
        let bindings = HotkeyBindings()
        XCTAssertEqual(bindings.validate(HotkeyCombo(.fn, .shift), for: .transcription), .ok)
        XCTAssertNil(bindings.owner(of: HotkeyCombo(.fn, .shift), excluding: .transcription))
    }

    func testAnzeigeLabelHatFesteReihenfolge() {
        XCTAssertEqual(HotkeyCombo(.command, .shift, .fn).displayLabel, "fn + Shift + Cmd")
        XCTAssertEqual(HotkeyCombo(.option, .control).displayLabel, "Ctrl + Option")
    }

    func testUmrechnungAusEreignisFlags() {
        let kombination = HotkeyCombo(flags: [.function, .shift, .option, .capsLock])
        XCTAssertEqual(kombination, HotkeyCombo(.fn, .shift, .option))
        XCTAssertTrue(kombination.eventFlags.contains(.function))
        XCTAssertFalse(kombination.eventFlags.contains(.command))
        XCTAssertTrue(HotkeyCombo(flags: []).isEmpty)
    }

    func testEchteTeilmenge() {
        XCTAssertTrue(HotkeyCombo(.fn, .shift).isStrictSubset(of: HotkeyCombo(.fn, .shift, .option)))
        XCTAssertFalse(HotkeyCombo(.fn, .shift).isStrictSubset(of: HotkeyCombo(.fn, .shift)))
        XCTAssertFalse(HotkeyCombo(.fn, .command).isStrictSubset(of: HotkeyCombo(.fn, .shift, .option)))
    }

    func testCodableRundlauf() throws {
        var bindings = HotkeyBindings()
        bindings.set(HotkeyCombo(.control, .option), for: .emojiText)

        let daten = try JSONEncoder().encode(bindings)
        let geladen = try JSONDecoder().decode(HotkeyBindings.self, from: daten)

        XCTAssertEqual(geladen, bindings)
        XCTAssertEqual(geladen.combo(for: .emojiText), HotkeyCombo(.control, .option))
    }

    func testLeeresJsonLiefertStandards() throws {
        let geladen = try JSONDecoder().decode(HotkeyBindings.self, from: Data("{}".utf8))
        XCTAssertFalse(geladen.hasOverrides)
        XCTAssertEqual(geladen.combo(for: .transcription), HotkeyCombo(.fn, .shift))
    }

    func testUnbrauchbareEintraegeWerdenVerworfen() throws {
        let json = """
        {"transcription":["fn","hyper"],"gibtEsNicht":["fn","shift"],"emojiText":["control","option"]}
        """
        let geladen = try JSONDecoder().decode(HotkeyBindings.self, from: Data(json.utf8))

        // "hyper" faellt weg, damit bleibt nur ein Modifier uebrig und der
        // Eintrag wird verworfen. Der unbekannte Workflow-Schluessel ebenso.
        XCTAssertEqual(geladen.combo(for: .transcription), HotkeyBindings.defaultCombo(for: .transcription))
        XCTAssertEqual(geladen.combo(for: .emojiText), HotkeyCombo(.control, .option))
    }
}
