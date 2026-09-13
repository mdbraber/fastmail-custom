import Foundation
import Testing
@testable import FastmailShellKit

private func fresh() -> UserDefaults {
    let name = "push-preferences-\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: name)!
    defaults.removePersistentDomain(forName: name)
    return defaults
}

@Test func aDeviceThatNeverChoseGetsInboxAlerts() {
    #expect(PushPreferences.choice(in: fresh()) == NotificationChoice(mode: .inbox))
}

// The old switch is read once: off becomes Off, on or never touched becomes
// All in inbox, and a choice already made is left alone
@Test func theOldSwitchSeedsTheChoiceOnce() {
    let off = fresh()
    off.set(false, forKey: "push.alerts")
    off.set(false, forKey: "push.alertsAcknowledged")
    PushPreferences.migrate(in: off)
    #expect(off.string(forKey: "push.mode") == "off")
    #expect(off.object(forKey: "push.alertsAcknowledged") == nil)
    #expect(off.object(forKey: "push.alerts") as? Bool == false, "read, not rewritten")

    let on = fresh()
    on.set(true, forKey: "push.alerts")
    PushPreferences.migrate(in: on)
    #expect(on.string(forKey: "push.mode") == "inbox")

    let never = fresh()
    PushPreferences.migrate(in: never)
    #expect(never.string(forKey: "push.mode") == "inbox")

    let chosen = fresh()
    chosen.set("custom", forKey: "push.mode")
    chosen.set(false, forKey: "push.alerts")
    PushPreferences.migrate(in: chosen)
    #expect(chosen.string(forKey: "push.mode") == "custom")
}

@Test func aSavedChoiceReadsBack() {
    let defaults = fresh()
    let choice = NotificationChoice(mode: .custom, senders: .contacts, mailboxIds: ["P2F", "P3V"])
    PushPreferences.save(choice, in: defaults)
    #expect(PushPreferences.choice(in: defaults) == choice)
    #expect(defaults.string(forKey: "push.mode") == "custom")
    #expect(defaults.string(forKey: "push.senders") == "contacts")
    #expect(defaults.stringArray(forKey: "push.mailboxIds") == ["P2F", "P3V"])
}

@Test func storedNonsenseReadsAsTheDefaults() {
    let defaults = fresh()
    defaults.set("loud", forKey: "push.mode")
    defaults.set("friends", forKey: "push.senders")
    defaults.set(["", "P2F", "P2F"], forKey: "push.mailboxIds")
    #expect(PushPreferences.choice(in: defaults) == NotificationChoice(mode: .inbox, senders: .everyone, mailboxIds: ["P2F"]))
}

// The server learns the choice only through a registration, so the app
// remembers the choice the server accepted and registers again on a difference
@Test func aRegistrationIsDueUntilTheServerAcceptedTheChoiceAsItStands() {
    let defaults = fresh()
    #expect(PushPreferences.registrationDue(in: defaults) == true, "nothing acknowledged yet")

    let inbox = NotificationChoice(mode: .inbox)
    PushPreferences.save(inbox, in: defaults)
    PushPreferences.acknowledge(inbox, contacts: true, in: defaults)
    #expect(PushPreferences.registrationDue(in: defaults) == false)

    let custom = NotificationChoice(mode: .custom, mailboxIds: ["P2F"])
    PushPreferences.save(custom, in: defaults)
    #expect(PushPreferences.registrationDue(in: defaults) == true)

    PushPreferences.acknowledge(custom, contacts: true, in: defaults)
    #expect(PushPreferences.registrationDue(in: defaults) == false)

    PushPreferences.save(NotificationChoice(mode: .custom, mailboxIds: ["P2F", "P3V"]), in: defaults)
    #expect(PushPreferences.registrationDue(in: defaults) == true, "a label added is a change")

    defaults.set("not json", forKey: "push.acknowledged")
    #expect(PushPreferences.registrationDue(in: defaults) == true, "an unreadable acknowledgement is none")
}

@Test func theContactsFlagFollowsTheLastReply() {
    let defaults = fresh()
    let inbox = NotificationChoice(mode: .inbox)
    #expect(PushPreferences.contacts(in: defaults) == nil)
    PushPreferences.acknowledge(inbox, contacts: false, in: defaults)
    #expect(PushPreferences.contacts(in: defaults) == false)
    PushPreferences.acknowledge(inbox, contacts: true, in: defaults)
    #expect(PushPreferences.contacts(in: defaults) == true)
    PushPreferences.acknowledge(inbox, contacts: nil, in: defaults)
    #expect(PushPreferences.contacts(in: defaults) == nil, "a reply without the flag makes it unknown again")
}
