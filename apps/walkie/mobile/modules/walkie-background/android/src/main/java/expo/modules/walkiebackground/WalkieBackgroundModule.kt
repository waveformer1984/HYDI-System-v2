package expo.modules.walkiebackground

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS bridge for [WalkieForegroundService]. All logic lives in the service. */
class WalkieBackgroundModule : Module() {
  private val context
    get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  override fun definition() = ModuleDefinition {
    Name("WalkieBackground")

    Events("onServiceEvent")

    OnCreate {
      WalkieForegroundService.listener = { event -> sendEvent("onServiceEvent", mapOf("type" to event)) }
    }

    OnDestroy {
      WalkieForegroundService.listener = null
    }

    Function("isRunning") { WalkieForegroundService.running }

    Function("hasMicrophoneType") { WalkieForegroundService.runningWithMicrophone }

    // Must be called while the app is in the foreground.
    Function("start") { channelName: String, status: String ->
      val intent = Intent(context, WalkieForegroundService::class.java)
        .setAction(WalkieForegroundService.ACTION_START)
        .putExtra(WalkieForegroundService.EXTRA_CHANNEL_NAME, channelName)
        .putExtra(WalkieForegroundService.EXTRA_STATUS, status)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
    }

    Function("update") { status: String, detail: String?, transmitting: Boolean, canTalk: Boolean ->
      if (!WalkieForegroundService.running) return@Function
      val intent = Intent(context, WalkieForegroundService::class.java)
        .setAction(WalkieForegroundService.ACTION_UPDATE)
        .putExtra(WalkieForegroundService.EXTRA_STATUS, status)
        .putExtra(WalkieForegroundService.EXTRA_DETAIL, detail)
        .putExtra(WalkieForegroundService.EXTRA_TRANSMITTING, transmitting)
        .putExtra(WalkieForegroundService.EXTRA_CAN_TALK, canTalk)
      // The service is already in the foreground, so a plain startService is
      // allowed even while the app is in the background.
      context.startService(intent)
    }

    Function("stop") {
      if (!WalkieForegroundService.running) return@Function
      context.startService(
        Intent(context, WalkieForegroundService::class.java).setAction(WalkieForegroundService.ACTION_STOP),
      )
    }
  }
}
