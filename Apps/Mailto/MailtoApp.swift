import SwiftUI
import FastmailShellKit

/// The chooser. A mailto link arrives, it asks which account the message is
/// from, and hands the link to that shell's compose window.
///
/// It holds no mail and signs in to nothing: both shells already answer
/// `compose?mailto=`, so this only asks the question and forwards the answer.
@main
struct MailtoApp: App {
    @State private var mailto: URL?

    var body: some Scene {
        WindowGroup {
            ChooserView(mailto: mailto)
                // A link that arrives while the app is already open replaces
                // the one on screen; the newest tap is the one you meant.
                // A mailto arrives either as itself or wrapped in this app's
                // own scheme, which is how Shortcuts can reach it while iOS
                // still gives mailto taps to the default mail app.
                .onOpenURL { url in
                    if let arrived = MailtoChooser.incoming(url) { mailto = arrived }
                }
        }
    }
}

struct ChooserView: View {
    let mailto: URL?

    var body: some View {
        VStack(spacing: 48) {
            Spacer()
            if let mailto, let summary = MailtoChooser.summary(of: mailto) {
                message(summary)
                buttons(for: mailto)
            } else {
                waiting
            }
            Spacer()
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
    }

    /// Who it is to and what it is about, so a link tapped by accident is
    /// caught here rather than in a compose window in the wrong account.
    private func message(_ summary: MailtoSummary) -> some View {
        VStack(spacing: 8) {
            Text(summary.recipients.isEmpty ? "New message" : summary.recipients)
                .font(.title2.weight(.semibold))
                .multilineTextAlignment(.center)
            if let subject = summary.subject {
                Text(subject)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
            }
        }
    }

    private func buttons(for mailto: URL) -> some View {
        VStack(spacing: 14) {
            Text("Send from")
                .font(.footnote.weight(.medium))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
            ForEach(MailtoChooser.targets) { target in
                Button {
                    open(mailto, in: target)
                } label: {
                    VStack(spacing: 2) {
                        Text(target.title).font(.headline)
                        Text(target.subtitle).font(.caption).foregroundStyle(.white.opacity(0.85))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent)
                .tint(tint(target))
                .controlSize(.large)
                .disabled(!installed(target))
            }
        }
    }

    private var waiting: some View {
        VStack(spacing: 10) {
            Text("Mailto")
                .font(.title2.weight(.semibold))
            Text("Open a mailto: link and this asks whether to write it from \(MailtoChooser.targets[0].subtitle) or \(MailtoChooser.targets[1].subtitle).")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            // iOS gives mailto taps to the default mail app, which this
            // cannot be until Apple grants the capability. Until then the
            // way in is a Shortcut opening this address.
            Text("\(MailtoChooser.scheme)://compose?mailto=…")
                .font(.footnote.monospaced())
                .foregroundStyle(.tertiary)
                .padding(.top, 4)
        }
    }

    /// A colour each, so the answer is a glance rather than a read: green is
    /// personal, blue is work. Anything the chooser learns to offer later
    /// falls back to the system's own accent rather than borrowing one of
    /// these two, which mean something.
    private func tint(_ target: MailtoTarget) -> Color {
        switch target.id {
        case "personal": return .green
        case "work": return .blue
        default: return .accentColor
        }
    }

    /// A button for an app that is not on this phone would be a dead end, so
    /// it is offered only when the shell is there to answer.
    private func installed(_ target: MailtoTarget) -> Bool {
        guard let probe = URL(string: "\(target.scheme)://open") else { return false }
        return UIApplication.shared.canOpenURL(probe)
    }

    private func open(_ mailto: URL, in target: MailtoTarget) {
        guard let command = MailtoChooser.compose(mailto, in: target) else { return }
        UIApplication.shared.open(command)
    }
}
