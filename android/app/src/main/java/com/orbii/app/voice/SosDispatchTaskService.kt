package com.orbii.app.voice

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Runs the Voice-SOS dispatch as a HeadlessJS task — i.e. the JS `createSOS`
 * (realtime broadcast + Supabase write) with NO React UI. Started by
 * VoiceGuardService when its native cancel countdown expires, so the alert
 * goes out even when the phone is locked, the app is backgrounded, or the app
 * was killed.
 *
 * The task name must match `AppRegistry.registerHeadlessTask('OrbiiSOSDispatch')`
 * in index.js.
 */
class SosDispatchTaskService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig {
    return HeadlessJsTaskConfig(
      "OrbiiSOSDispatch",
      Arguments.createMap(),
      30000L, // timeout (ms) — plenty for a location fix + broadcast
      true,   // allowedInForeground — let it run even if the app is visible
    )
  }
}
