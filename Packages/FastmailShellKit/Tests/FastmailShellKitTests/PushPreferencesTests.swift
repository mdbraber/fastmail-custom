import Foundation
import Testing
@testable import FastmailShellKit

private func fresh() -> UserDefaults {
    let name = "push-preferences-\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: name)!
    defaults.removePersistentDomain(forName: name)
    return defaults
}

@Test func alertsAreOnUntilSomebodyTurnsThemOff() {
    let defaults = fresh()
    #expect(PushPreferences.alertsEnabled(in: defaults) == true)
    defaults.set(false, forKey: PushPreferences.alertsKey)
    #expect(PushPreferences.alertsEnabled(in: defaults) == false)
    defaults.set(true, forKey: PushPreferences.alertsKey)
    #expect(PushPreferences.alertsEnabled(in: defaults) == true)
}

// The server only learns about the switch through a registration, so the
// app remembers what it last told the server and re-registers on a difference
@Test func aRegistrationIsDueWheneverTheSwitchDiffersFromWhatTheServerWasTold() {
    let defaults = fresh()
    #expect(PushPreferences.registrationDue(in: defaults) == true, "nothing acknowledged yet")

    PushPreferences.acknowledge(alerts: true, in: defaults)
    #expect(PushPreferences.registrationDue(in: defaults) == false)

    defaults.set(false, forKey: PushPreferences.alertsKey)
    #expect(PushPreferences.registrationDue(in: defaults) == true)

    PushPreferences.acknowledge(alerts: false, in: defaults)
    #expect(PushPreferences.registrationDue(in: defaults) == false)

    defaults.removeObject(forKey: PushPreferences.alertsKey)
    #expect(PushPreferences.registrationDue(in: defaults) == true, "back to the default, on")
}
