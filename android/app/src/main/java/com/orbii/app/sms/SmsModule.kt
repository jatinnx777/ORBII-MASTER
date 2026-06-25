package com.orbii.app.sms

import android.os.Build
import android.telephony.SmsManager
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray

/**
 * Direct SMS send for the SOS fallback. Unlike a share/compose intent, this
 * fires the text WITHOUT the user having to tap send — which is the whole point
 * during an emergency (the victim may be unable to interact). Reaches contacts
 * who don't use ORBII, and works with no data connection.
 *
 * Requires the SEND_SMS runtime permission (requested from JS). Returns how many
 * recipients were actually handed to the SMS stack, for the delivery summary.
 */
class SmsModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  override fun getName() = "OrbiiSms"

  @ReactMethod
  fun sendSms(addresses: ReadableArray, body: String, promise: Promise) {
    try {
      val sms = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        ctx.getSystemService(SmsManager::class.java)
      } else {
        @Suppress("DEPRECATION")
        SmsManager.getDefault()
      }
      if (sms == null) {
        promise.resolve(0)
        return
      }
      var sent = 0
      for (i in 0 until addresses.size()) {
        val to = addresses.getString(i)?.trim() ?: continue
        if (to.isEmpty()) continue
        try {
          val parts = sms.divideMessage(body)
          if (parts.size > 1) {
            sms.sendMultipartTextMessage(to, null, parts, null, null)
          } else {
            sms.sendTextMessage(to, null, body, null, null)
          }
          sent++
        } catch (e: Exception) {
          Log.w("OrbiiSms", "SMS send failed for one recipient", e)
        }
      }
      promise.resolve(sent)
    } catch (e: Exception) {
      promise.reject("sms_failed", e)
    }
  }

  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Double) {}
}
