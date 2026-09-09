import XCTest
import AppKit

@MainActor
final class HotkeyRecorderTests: XCTestCase {
    func testAufbauenEinerKombinationErgibtDieGroesste() {
        let recorder = HotkeyRecorder()
        var uebernommen: HotkeyCombo?
        recorder.arm(
            onCommit: { uebernommen = $0 },
            onCancel: { XCTFail("kein Abbruch erwartet") }
        )

        recorder.verarbeite(flags: [.function])
        recorder.verarbeite(flags: [.function, .shift])
        recorder.verarbeite(flags: [.function, .shift, .option])
        recorder.verarbeite(flags: [])

        XCTAssertEqual(uebernommen, HotkeyCombo(.fn, .shift, .option))
        XCTAssertFalse(recorder.laeuft)
    }

    func testTeilmengeBeimLoslassenAendertKandidatenNicht() {
        let recorder = HotkeyRecorder()
        var uebernommen: HotkeyCombo?
        recorder.arm(
            onCommit: { uebernommen = $0 },
            onCancel: { XCTFail("kein Abbruch erwartet") }
        )

        recorder.verarbeite(flags: [.function, .shift, .option])
        // Option losgelassen: reine Teilmenge, darf den Kandidaten nicht aendern.
        recorder.verarbeite(flags: [.function, .shift])
        XCTAssertEqual(recorder.groessteKombination, HotkeyCombo(.fn, .shift, .option))

        recorder.verarbeite(flags: [])

        XCTAssertEqual(uebernommen, HotkeyCombo(.fn, .shift, .option))
    }

    func testGleicheGroesseGewinntDieZuletztGehalteneMenge() {
        let recorder = HotkeyRecorder()
        var uebernommen: HotkeyCombo?
        recorder.arm(
            onCommit: { uebernommen = $0 },
            onCancel: { XCTFail("kein Abbruch erwartet") }
        )

        recorder.verarbeite(flags: [.control, .option])
        recorder.verarbeite(flags: [.control]) // Option losgelassen
        recorder.verarbeite(flags: [.control, .shift]) // Shift gedrueckt, gleiche Groesse wie zuvor
        recorder.verarbeite(flags: [])

        XCTAssertEqual(uebernommen, HotkeyCombo(.control, .shift))
    }

    func testAufnahmeOhneGedrueckenModifierUebernimmtNichts() {
        let recorder = HotkeyRecorder()
        var commitAufgerufen = false
        recorder.arm(
            onCommit: { _ in commitAufgerufen = true },
            onCancel: { XCTFail("kein Abbruch erwartet") }
        )

        recorder.verarbeite(flags: [])

        XCTAssertFalse(commitAufgerufen)
    }

    func testAbbrechenRuftHandlerUndUebernimmtNichts() {
        let recorder = HotkeyRecorder()
        var commitAufgerufen = false
        var abbruchAufgerufen = false
        recorder.arm(
            onCommit: { _ in commitAufgerufen = true },
            onCancel: { abbruchAufgerufen = true }
        )

        recorder.verarbeite(flags: [.function, .shift])
        recorder.abbrechen()

        XCTAssertTrue(abbruchAufgerufen)
        XCTAssertFalse(commitAufgerufen)
        XCTAssertFalse(recorder.laeuft)
    }
}
