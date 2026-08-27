package com.orbii.app.referrer

import android.content.Context
import com.android.installreferrer.api.InstallReferrerClient
import com.android.installreferrer.api.InstallReferrerStateListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Reads the Play Install Referrer once, on first launch.
 *
 * WHY NOT A DEEP LINK. A deep link only works if the app is already installed.
 * The campus ambassador case is the opposite: somebody taps orbii.app/ref/SRMS01
 * on a poster, goes to the Play Store, installs, and opens the app minutes or
 * days later. The referrer string is the only thing that survives that round
 * trip, and Play holds it for the install regardless of how long they take.
 *
 * WHY NOT AN NPM WRAPPER. This is 60 lines against a first-party Google library
 * that is already a transitive dependency of Play Services. A wrapper package
 * would add a maintenance surface and an autolinking step for no benefit.
 *
 * IT NEVER THROWS AND NEVER BLOCKS. Every failure resolves to an empty string.
 * The referrer is a marketing nicety; the signup it sits next to is a woman
 * setting up a safety app, and nothing here is allowed to interfere with that.
 */
class OrbiiReferrerModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  override fun getName() = "OrbiiReferrer"

  /**
   * Guards against a second connection.
   *
   * InstallReferrerClient allows one connection at a time, and JS may call this
   * twice if a screen remounts during startup. A second attempt while the first
   * is open throws inside the Play library rather than returning an error, so
   * it is stopped here.
   */
  private val busy = AtomicBoolean(false)

  @ReactMethod
  fun getInstallReferrer(promise: Promise) {
    if (!busy.compareAndSet(false, true)) {
      promise.resolve("")
      return
    }

    val client = try {
      InstallReferrerClient.newBuilder(ctx.applicationContext).build()
    } catch (e: Exception) {
      busy.set(false)
      promise.resolve("")
      return
    }

    // Resolve exactly once. The listener can fire onSetupFinished and then
    // onServiceDisconnected, and resolving a Promise twice crashes the bridge.
    val settled = AtomicBoolean(false)
    fun finish(value: String) {
      if (settled.compareAndSet(false, true)) {
        busy.set(false)
        try { client.endConnection() } catch (e: Exception) {}
        promise.resolve(value)
      }
    }

    try {
      client.startConnection(object : InstallReferrerStateListener {
        override fun onInstallReferrerSetupFinished(responseCode: Int) {
          if (responseCode != InstallReferrerClient.InstallReferrerResponse.OK) {
            // FEATURE_NOT_SUPPORTED on old Play Store builds, SERVICE_UNAVAILABLE
            // on a sideloaded APK. Both are ordinary, not errors.
            finish("")
            return
          }
          val referrer = try {
            client.installReferrer.installReferrer ?: ""
          } catch (e: Exception) {
            ""
          }
          finish(referrer)
        }

        override fun onInstallReferrerServiceDisconnected() {
          // Do not retry. If Play dropped us, the user is mid-onboarding and a
          // reconnect loop is not worth a referral code.
          finish("")
        }
      })
    } catch (e: Exception) {
      finish("")
    }
  }
}
