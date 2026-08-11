import SwiftUI

public struct AppShell: View {
    private let profile: Profile
    @StateObject private var model = ShellModel()

    public init(profile: Profile) {
        self.profile = profile
    }

    public var body: some View {
        ZStack(alignment: .top) {
            WebContainer(profile: profile, model: model)
                .ignoresSafeArea()
            if let banner = model.banner {
                HStack(alignment: .top) {
                    Text(banner)
                        .font(.callout)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 8)
                    Button("Dismiss") { model.banner = nil }
                        .buttonStyle(.plain)
                }
                .padding(12)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10))
                .padding(12)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.default, value: model.banner)
    }
}
