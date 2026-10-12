package expo.modules.walkiebackground

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log

/**
 * Keeps a joined Walkie channel alive while the app is in the background
 * (Milestone 2). It owns no audio itself: LiveKit/WebRTC keeps running in
 * the app process, and this service is what Android requires for that
 * process to keep its microphone access and stay scheduled in the
 * background. It must be started while the app is visible (Android 12+
 * forbids starting a microphone foreground service from the background), so
 * the app starts it when the user joins a channel and stops it on leave.
 *
 * The microphone is never opened by this service. The notification's Talk
 * button only asks the JS layer to request a speaking turn from the server;
 * the server still decides, and the turn is still capped at its maximum
 * duration.
 */
class WalkieForegroundService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null
  private var state = NotificationState()

  data class NotificationState(
    val channelName: String = "",
    val status: String = "Connecting…",
    val detail: String? = null,
    val transmitting: Boolean = false,
    val canTalk: Boolean = false,
  )

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> start(intent)
      ACTION_UPDATE -> update(intent)
      ACTION_STOP -> {
        shutdown()
        return START_NOT_STICKY
      }
      ACTION_TALK, ACTION_STOP_TALK, ACTION_LEAVE -> {
        val event = when (intent.action) {
          ACTION_TALK -> EVENT_TALK
          ACTION_STOP_TALK -> EVENT_STOP_TALK
          else -> EVENT_LEAVE
        }
        // A notification action that reaches a service with no live session
        // (e.g. the process was recreated just to deliver it) has nobody to
        // act on it: end instead of lingering as a plain background service.
        if (!running || !emit(event)) {
          shutdown()
          return START_NOT_STICKY
        }
      }
      // Restarted by the system with a null intent: the JS session that
      // owned us is gone, so do not linger.
      else -> {
        shutdown()
        return START_NOT_STICKY
      }
    }
    // Never auto-restart: a restarted service without its JS session would
    // show a channel the app is no longer connected to.
    return START_NOT_STICKY
  }

  private fun start(intent: Intent) {
    state = NotificationState(
      channelName = intent.getStringExtra(EXTRA_CHANNEL_NAME) ?: "Walkie",
      status = intent.getStringExtra(EXTRA_STATUS) ?: "Connecting…",
    )
    ensureChannel()
    val micGranted = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, buildNotification(), foregroundTypes(micGranted))
      } else {
        startForeground(NOTIFICATION_ID, buildNotification())
      }
    } catch (e: Exception) {
      // ForegroundServiceStartNotAllowedException (started from background)
      // or SecurityException (type/permission mismatch).
      Log.w(TAG, "startForeground failed: ${e.javaClass.simpleName}: ${e.message}")
      emit(EVENT_START_FAILED)
      stopSelf()
      return
    }
    running = true
    runningWithMicrophone = micGranted
    acquireWakeLock()
    emit(EVENT_STARTED)
  }

  private fun update(intent: Intent) {
    if (!running) return
    state = state.copy(
      status = intent.getStringExtra(EXTRA_STATUS) ?: state.status,
      detail = intent.getStringExtra(EXTRA_DETAIL),
      transmitting = intent.getBooleanExtra(EXTRA_TRANSMITTING, false),
      canTalk = intent.getBooleanExtra(EXTRA_CAN_TALK, false),
    )
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    nm.notify(NOTIFICATION_ID, buildNotification())
  }

  private fun shutdown() {
    releaseWakeLock()
    if (running) stopForeground(STOP_FOREGROUND_REMOVE)
    running = false
    runningWithMicrophone = false
    stopSelf()
  }

  override fun onDestroy() {
    releaseWakeLock()
    val wasRunning = running
    running = false
    runningWithMicrophone = false
    if (wasRunning) emit(EVENT_STOPPED)
    super.onDestroy()
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (nm.getNotificationChannel(CHANNEL_ID) != null) return
    val ch = NotificationChannel(CHANNEL_ID, "Walkie connection", NotificationManager.IMPORTANCE_LOW)
    ch.description = "Shown while Walkie stays connected to a channel in the background"
    ch.setShowBadge(false)
    nm.createNotificationChannel(ch)
  }

  @Suppress("DEPRECATION")
  private fun buildNotification(): Notification {
    val title = if (state.transmitting) "Transmitting · ${state.channelName}" else state.channelName
    val text = listOfNotNull(state.status, state.detail).joinToString(" · ")
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      Notification.Builder(this).setPriority(Notification.PRIORITY_LOW)
    }
    builder
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setContentTitle(title)
      .setContentText(text)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_SERVICE)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    }
    openAppIntent()?.let { builder.setContentIntent(it) }
    if (state.transmitting) {
      builder.addAction(Notification.Action.Builder(null, "Stop talking", serviceIntent(ACTION_STOP_TALK, 1)).build())
    } else if (state.canTalk) {
      builder.addAction(Notification.Action.Builder(null, "Talk", serviceIntent(ACTION_TALK, 2)).build())
    }
    builder.addAction(Notification.Action.Builder(null, "Disconnect", serviceIntent(ACTION_LEAVE, 3)).build())
    return builder.build()
  }

  private fun serviceIntent(action: String, requestCode: Int): PendingIntent =
    PendingIntent.getService(
      this,
      requestCode,
      Intent(this, WalkieForegroundService::class.java).setAction(action),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  private fun openAppIntent(): PendingIntent? {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    return PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    // Keeps the CPU (not the screen) awake so incoming audio is processed
    // with the screen off. Bounded so a leaked lock cannot drain the battery
    // indefinitely; a session longer than this keeps running but may be
    // throttled by the OS.
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "walkie:session").apply {
      setReferenceCounted(false)
      acquire(WAKE_LOCK_MAX_MS)
    }
  }

  private fun releaseWakeLock() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
  }

  companion object {
    private const val TAG = "WalkieFGS"
    const val CHANNEL_ID = "walkie_session"
    const val NOTIFICATION_ID = 4711
    const val WAKE_LOCK_MAX_MS = 8L * 60 * 60 * 1000

    const val ACTION_START = "expo.modules.walkiebackground.START"
    const val ACTION_UPDATE = "expo.modules.walkiebackground.UPDATE"
    const val ACTION_STOP = "expo.modules.walkiebackground.STOP"
    const val ACTION_TALK = "expo.modules.walkiebackground.TALK"
    const val ACTION_STOP_TALK = "expo.modules.walkiebackground.STOP_TALK"
    const val ACTION_LEAVE = "expo.modules.walkiebackground.LEAVE"

    const val EXTRA_CHANNEL_NAME = "channelName"
    const val EXTRA_STATUS = "status"
    const val EXTRA_DETAIL = "detail"
    const val EXTRA_TRANSMITTING = "transmitting"
    const val EXTRA_CAN_TALK = "canTalk"

    const val EVENT_STARTED = "started"
    const val EVENT_START_FAILED = "start_failed"
    const val EVENT_STOPPED = "stopped"
    const val EVENT_TALK = "talk"
    const val EVENT_STOP_TALK = "stop_talk"
    const val EVENT_LEAVE = "leave"

    @Volatile var running = false
      private set

    @Volatile var runningWithMicrophone = false
      private set

    /** Set by the Expo module; receives notification actions and lifecycle events. */
    @Volatile var listener: ((String) -> Unit)? = null

    private fun emit(event: String): Boolean {
      val l = listener ?: return false
      l(event)
      return true
    }

    /** Types to request: microphone only when RECORD_AUDIO is granted (Android 14+ throws otherwise). */
    fun foregroundTypes(micGranted: Boolean): Int {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return 0
      return if (micGranted) {
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
      } else {
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
      }
    }
  }
}
