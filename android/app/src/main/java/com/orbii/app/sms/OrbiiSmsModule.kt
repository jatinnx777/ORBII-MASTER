package com.orbii.app.sms

import android.os.Build
import android.telephony.SmsManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray

/**
 * Hands-free SMS lifeline. Sends the SOS text to emergency contacts directly
 * (no composer, no tap) over the cellular signaling channel, which works with
 * mobile data off, on bare 2G, deep in a village. Requires SEND_SMS, which the
 * JS layer only calls once the user has granted it. Long messages are split.
 *
 * Play note: SEND_SMS is a restricted permission. For a Play release ORBII must
 * either be an approved exception (a genuine safety-SOS justification) or fall
 * back to the system composer (services/sms.ts). Sideloaded test builds work as
 * is.
 */
class OrbiiSmsModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  override fun getName() = "OrbiiSms"

  @ReactMethod
  fun sendSms(numbers: ReadableArray, message: String, promise: Promise) {
    try {
      @Suppress("DEPRECATION")
      val sm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
        ctx.getSystemService(SmsManager::class.java)
      else
        SmsManager.getDefault()

      var sent = 0
      for (i in 0 until numbers.size()) {
        val num = numbers.getString(i) ?: continue
        if (num.isBlank()) continue
        val parts = sm.divideMessage(message)
        if (parts.size > 1) {
          sm.sendMultipartTextMessage(num, null, parts, null, null)
        } else {
          sm.sendTextMessage(num, null, message, null, null)
        }
        sent++
      }
      promise.resolve(sent)
    } catch (e: Exception) {
      promise.reject("sms_failed", e)
    }
  }

  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Double) {}
}
