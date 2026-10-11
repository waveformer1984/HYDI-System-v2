import AVFoundation
import Foundation
import PushToTalk

/// Owns the app's single `PTChannelManager` (Milestone 3).
///
/// Apple's rules this follows (see "Creating a Push to Talk app"):
/// - create the channel manager as early as possible at launch, so the system
///   can restore a joined channel and deliver PTT pushes to a relaunched app;
/// - answer `incomingPushResult` and `channelDescriptor(restoredChannelUUID:)`
///   immediately, without network calls (both are answered from the push
///   payload or a local cache here, never from JavaScript);
/// - never activate the audio session: the system does, and reports it via
///   `didActivate` / `didDeactivate`, which are forwarded to JS so WebRTC can
///   start and stop its audio unit.
///
/// Walkie channel ids are UUIDs, so they are used directly as channel UUIDs.
final class PttController: NSObject, PTChannelManagerDelegate, PTChannelRestorationDelegate {
  static let shared = PttController()

  private(set) var manager: PTChannelManager?
  private var setUpWaiters: [(Error?) -> Void] = []
  private var settingUp = false

  /// Set by the Expo module; receives every event as a dictionary.
  var emit: (([String: Any]) -> Void)?

  /// Kept for JS that starts after the event fired (cold launch by a push).
  private(set) var lastPushToken: String?
  private(set) var lastSpeakerPush: [String: Any]?

  private let namesKey = "walkie.ptt.channelNames"
  private let activeKey = "walkie.ptt.activeChannel"

  // MARK: - Setup

  /// Builds made without WALKIE_IOS_PTT=1 lack the entitlement and background
  /// mode; never touch the PushToTalk framework in them.
  static var isEnabledInBuild: Bool {
    (Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String])?.contains("push-to-talk") == true
  }

  func setUp(_ done: ((Error?) -> Void)? = nil) {
    guard PttController.isEnabledInBuild else {
      done?(PttError.unavailable)
      return
    }
    if manager != nil {
      done?(nil)
      return
    }
    if let done { setUpWaiters.append(done) }
    if settingUp { return }
    settingUp = true
    PTChannelManager.channelManager(delegate: self, restorationDelegate: self) { [weak self] manager, error in
      DispatchQueue.main.async {
        guard let self else { return }
        self.manager = manager
        self.settingUp = false
        let waiters = self.setUpWaiters
        self.setUpWaiters = []
        waiters.forEach { $0(error) }
        if let error { self.send(["type": "error", "stage": "setup", "message": error.localizedDescription]) }
      }
    }
  }

  // MARK: - Commands (from JS)

  func join(channelId: String, name: String, done: @escaping (Error?) -> Void) {
    guard let uuid = UUID(uuidString: channelId) else {
      done(PttError.badChannelId)
      return
    }
    setUp { [weak self] error in
      guard let self, let manager = self.manager else {
        done(error ?? PttError.unavailable)
        return
      }
      self.remember(name: name, for: uuid)
      // Configuring the category is allowed; activating the session is not.
      try? AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothHFP])
      manager.requestJoinChannel(channelUUID: uuid, descriptor: PTChannelDescriptor(name: name, image: nil))
      done(nil)
    }
  }

  func leave(channelId: String) {
    guard let uuid = UUID(uuidString: channelId) else { return }
    manager?.leaveChannel(channelUUID: uuid)
  }

  func requestBeginTransmitting(channelId: String) {
    guard let uuid = UUID(uuidString: channelId) else { return }
    manager?.requestBeginTransmitting(channelUUID: uuid)
  }

  func stopTransmitting(channelId: String) {
    guard let uuid = UUID(uuidString: channelId) else { return }
    manager?.stopTransmitting(channelUUID: uuid)
  }

  func setActiveRemoteParticipant(channelId: String, name: String?) {
    guard let uuid = UUID(uuidString: channelId) else { return }
    let participant = name.map { PTParticipant(name: $0, image: nil) }
    manager?.setActiveRemoteParticipant(participant, channelUUID: uuid) { [weak self] error in
      if let error { self?.send(["type": "error", "stage": "activeParticipant", "message": error.localizedDescription]) }
    }
  }

  func setServiceStatus(channelId: String, status: String) {
    guard let uuid = UUID(uuidString: channelId) else { return }
    let s: PTServiceStatus
    switch status {
    case "connecting": s = .connecting
    case "unavailable": s = .unavailable
    default: s = .ready
    }
    manager?.setServiceStatus(s, channelUUID: uuid) { _ in }
  }

  /// The joined channel. Until the channel manager finishes its asynchronous
  /// setup at launch, answered from the id persisted on the last join.
  var activeChannelId: String? {
    guard PttController.isEnabledInBuild else { return nil }
    if let manager { return manager.activeChannelUUID?.uuidString.lowercased() }
    return UserDefaults.standard.string(forKey: activeKey)
  }

  // MARK: - PTChannelManagerDelegate

  func channelManager(_ channelManager: PTChannelManager, didJoinChannel channelUUID: UUID, reason: PTChannelJoinReason) {
    UserDefaults.standard.set(id(channelUUID), forKey: activeKey)
    send(["type": "joined", "channelId": id(channelUUID), "reason": reason.rawValue])
  }

  func channelManager(_ channelManager: PTChannelManager, didLeaveChannel channelUUID: UUID, reason: PTChannelLeaveReason) {
    if UserDefaults.standard.string(forKey: activeKey) == id(channelUUID) {
      UserDefaults.standard.removeObject(forKey: activeKey)
    }
    send(["type": "left", "channelId": id(channelUUID), "reason": reason.rawValue])
  }

  func channelManager(_ channelManager: PTChannelManager, channelUUID: UUID, didBeginTransmittingFrom source: PTChannelTransmitRequestSource) {
    send(["type": "transmitBegan", "channelId": id(channelUUID), "source": sourceName(source)])
  }

  func channelManager(_ channelManager: PTChannelManager, channelUUID: UUID, didEndTransmittingFrom source: PTChannelTransmitRequestSource) {
    send(["type": "transmitEnded", "channelId": id(channelUUID), "source": sourceName(source)])
  }

  func channelManager(_ channelManager: PTChannelManager, receivedEphemeralPushToken pushToken: Data) {
    let hex = pushToken.map { String(format: "%02x", $0) }.joined()
    lastPushToken = hex
    send(["type": "pushToken", "token": hex])
  }

  func incomingPushResult(channelManager: PTChannelManager, channelUUID: UUID, pushPayload: [String: Any]) -> PTPushResult {
    if (pushPayload["leave"] as? Bool) == true {
      send(["type": "pushLeave", "channelId": id(channelUUID)])
      return .leaveChannel
    }
    let name = (pushPayload["activeSpeaker"] as? String) ?? "Someone"
    var event: [String: Any] = ["type": "pushSpeaker", "channelId": id(channelUUID), "speaker": name]
    if let uid = pushPayload["speakerUserId"] as? String { event["speakerUserId"] = uid }
    lastSpeakerPush = event
    send(event)
    return .activeRemoteParticipant(PTParticipant(name: name, image: nil))
  }

  func channelManager(_ channelManager: PTChannelManager, didActivate audioSession: AVAudioSession) {
    send(["type": "audioActivated"])
  }

  func channelManager(_ channelManager: PTChannelManager, didDeactivate audioSession: AVAudioSession) {
    send(["type": "audioDeactivated"])
  }

  func channelManager(_ channelManager: PTChannelManager, failedToJoinChannel channelUUID: UUID, error: any Error) {
    send(["type": "error", "stage": "join", "channelId": id(channelUUID), "message": error.localizedDescription])
  }

  func channelManager(_ channelManager: PTChannelManager, failedToLeaveChannel channelUUID: UUID, error: any Error) {
    send(["type": "error", "stage": "leave", "channelId": id(channelUUID), "message": error.localizedDescription])
  }

  func channelManager(_ channelManager: PTChannelManager, failedToBeginTransmittingInChannel channelUUID: UUID, error: any Error) {
    send(["type": "error", "stage": "beginTransmitting", "channelId": id(channelUUID), "message": error.localizedDescription])
  }

  func channelManager(_ channelManager: PTChannelManager, failedToStopTransmittingInChannel channelUUID: UUID, error: any Error) {
    send(["type": "error", "stage": "stopTransmitting", "channelId": id(channelUUID), "message": error.localizedDescription])
  }

  // MARK: - PTChannelRestorationDelegate

  func channelDescriptor(restoredChannelUUID channelUUID: UUID) -> PTChannelDescriptor {
    // Must return immediately: answered from the local cache only.
    PTChannelDescriptor(name: cachedName(for: channelUUID) ?? "Walkie", image: nil)
  }

  // MARK: - Helpers

  private func send(_ event: [String: Any]) {
    if Thread.isMainThread {
      emit?(event)
    } else {
      DispatchQueue.main.async { [weak self] in self?.emit?(event) }
    }
  }

  private func id(_ uuid: UUID) -> String { uuid.uuidString.lowercased() }

  private func sourceName(_ source: PTChannelTransmitRequestSource) -> String {
    switch source {
    case .userRequest: return "user"
    case .developerRequest: return "app"
    case .handsfreeButton: return "accessory"
    default: return "unknown"
    }
  }

  private func remember(name: String, for uuid: UUID) {
    var names = UserDefaults.standard.dictionary(forKey: namesKey) as? [String: String] ?? [:]
    names[id(uuid)] = name
    UserDefaults.standard.set(names, forKey: namesKey)
  }

  private func cachedName(for uuid: UUID) -> String? {
    (UserDefaults.standard.dictionary(forKey: namesKey) as? [String: String])?[id(uuid)]
  }
}

enum PttError: Error, LocalizedError {
  case badChannelId
  case unavailable

  var errorDescription: String? {
    switch self {
    case .badChannelId: return "Channel id is not a UUID"
    case .unavailable: return "PushToTalk is not available on this device"
    }
  }
}
