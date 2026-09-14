//
//  SafariWebExtensionHandler.swift
//  Fastmail Custom Mode Extension
//
//  Created by Maarten den Braber on 2026-08-11.
//

import Foundation
import SafariServices
import os.log

/// The extension's way to iCloud. The background script sends `get` for one
/// account's synced settings and `set` for one setting; this answers from the
/// iCloud key-value store the Personal and Work apps share.
///
/// What to answer is decided by SettingsSyncRules, the same file the apps
/// compile, so the key format and the local-only list cannot drift from
/// theirs. A native part cannot hear iCloud's change notices, which is why
/// the background script asks rather than being told.
class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem

        let message: Any?
        if #available(iOS 15.0, macOS 11.0, *) {
            message = request?.userInfo?[SFExtensionMessageKey]
        } else {
            message = request?.userInfo?["message"]
        }

        let store = NSUbiquitousKeyValueStore.default
        let answer = SettingsSyncRules.extensionAnswer(
            to: message as? [String: Any] ?? [:],
            hasICloudIdentity: FileManager.default.ubiquityIdentityToken != nil,
            storeContents: {
                // Whatever iCloud has delivered to this Mac so far
                _ = store.synchronize()
                return store.dictionaryRepresentation
            }
        )
        if let write = answer.write {
            store.set(write.value, forKey: write.key)
            _ = store.synchronize()
        }
        if let error = answer.reply["error"] as? String {
            os_log(.error, "Custom mode settings sync refused a message: %{public}@", error)
        }

        let response = NSExtensionItem()
        if #available(iOS 15.0, macOS 11.0, *) {
            response.userInfo = [SFExtensionMessageKey: answer.reply]
        } else {
            response.userInfo = ["message": answer.reply]
        }

        context.completeRequest(returningItems: [response], completionHandler: nil)
    }

}
