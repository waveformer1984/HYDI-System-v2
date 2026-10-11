import ExpoModulesCore

/// Thin JS bridge for `PttController`. All PushToTalk logic lives there.
public class WalkiePttModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WalkiePtt")

    Events("onPttEvent")

    OnCreate {
      PttController.shared.emit = { [weak self] event in
        self?.sendEvent("onPttEvent", event)
      }
      // Create the channel manager as early as possible so iOS can restore a
      // joined channel and deliver pushes after a relaunch.
      PttController.shared.setUp()
    }

    OnDestroy {
      PttController.shared.emit = nil
    }

    Function("activeChannelId") { () -> String? in
      PttController.shared.activeChannelId
    }

    Function("lastPushToken") { () -> String? in
      PttController.shared.lastPushToken
    }

    Function("lastSpeakerPush") { () -> [String: Any]? in
      PttController.shared.lastSpeakerPush
    }

    // Apple requires an explicit user action in the foreground to join.
    AsyncFunction("join") { (channelId: String, name: String, promise: Promise) in
      PttController.shared.join(channelId: channelId, name: name) { error in
        if let error {
          promise.reject("ERR_PTT_JOIN", error.localizedDescription)
        } else {
          promise.resolve(nil)
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("leave") { (channelId: String) in
      PttController.shared.leave(channelId: channelId)
    }.runOnQueue(.main)

    AsyncFunction("requestBeginTransmitting") { (channelId: String) in
      PttController.shared.requestBeginTransmitting(channelId: channelId)
    }.runOnQueue(.main)

    AsyncFunction("stopTransmitting") { (channelId: String) in
      PttController.shared.stopTransmitting(channelId: channelId)
    }.runOnQueue(.main)

    AsyncFunction("setActiveRemoteParticipant") { (channelId: String, name: String?) in
      PttController.shared.setActiveRemoteParticipant(channelId: channelId, name: name)
    }.runOnQueue(.main)

    AsyncFunction("setServiceStatus") { (channelId: String, status: String) in
      PttController.shared.setServiceStatus(channelId: channelId, status: status)
    }.runOnQueue(.main)
  }
}
