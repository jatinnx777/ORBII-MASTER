package com.orbii.app.oem

import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Deep links into the vendor settings pages that decide whether Voice SOS
 * survives the night.
 *
 * WHY THIS MODULE EXISTS. Voice SOS is a foreground service. On stock Android
 * that is enough. On the phones most Indian users actually own it is not:
 * MIUI, ColorOS, FuntouchOS and One UI each ship an aggressive task killer that
 * will stop a foreground service anyway unless the app is on an allow-list, and
 * each vendor buries that list somewhere different and calls it something
 * different. A woman whose phone silently killed the listener is not protected,
 * and she has no way of knowing.
 *
 * OEMHelpScreen already explains the taps. Until now its buttons dropped the
 * user on the generic app-info page and left them to find the rest, which on
 * MIUI is four more taps through a menu they have never seen. This module opens
 * the actual page.
 *
 * DESIGN RULE THROUGHOUT: never crash, never dead-end. Every vendor component
 * name here is undocumented and vendor-private. They get renamed between OS
 * versions, they differ between regions (vivo's Chinese and global builds do
 * not agree), and a component that resolves on MIUI 12 may not exist on MIUI 14.
 * So every attempt is guarded, the list is tried in order, and the last resort
 * is always the app details page, which has existed since API 9 and always
 * resolves. The worst outcome is the behaviour we had before this file.
 */
class OemSettingsModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val TAG = "OemSettings"
    const val NAME = "OemSettingsModule"

    /**
     * Vendor autostart / background-management screens, best first.
     *
     * Each entry is (package, activity). Order matters: the first that resolves
     * wins, and the more specific screen is listed before the more general one,
     * so a user lands on the autostart list itself rather than its parent menu.
     */
    private val XIAOMI = listOf(
      // MIUI security centre, autostart list. Also covers Redmi and POCO,
      // which are the same OS with different branding.
      "com.miui.securitycenter" to "com.miui.permcenter.autostart.AutoStartManagementActivity",
      "com.miui.securitycenter" to "com.miui.powercenter.PowerSettings",
    )

    private val OPPO = listOf(
      // ColorOS. The package renamed from coloros to oplus around ColorOS 12,
      // so both are tried. Realme and OnePlus run ColorOS derivatives.
      "com.coloros.safecenter" to "com.coloros.safecenter.permission.startup.StartupAppListActivity",
      "com.coloros.safecenter" to "com.coloros.safecenter.startupapp.StartupAppListActivity",
      "com.oppo.safe" to "com.oppo.safe.permission.startup.StartupAppListActivity",
      "com.oplus.safecenter" to "com.oplus.safecenter.permission.startup.StartupAppListActivity",
    )

    private val VIVO = listOf(
      // FuntouchOS / OriginOS. iQOO is vivo. The "white list" naming is theirs.
      "com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity",
      "com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager",
      "com.vivo.permissionmanager" to "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
    )

    private val HUAWEI = listOf(
      "com.huawei.systemmanager" to "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
      "com.huawei.systemmanager" to "com.huawei.systemmanager.optimize.process.ProtectActivity",
    )

    private val LETV = listOf(
      "com.letv.android.letvsafe" to "com.letv.android.letvsafe.AutobootManageActivity",
    )

    private val ASUS = listOf(
      "com.asus.mobilemanager" to "com.asus.mobilemanager.autostart.AutoStartActivity",
    )

    /**
     * Samsung is the exception: One UI has no autostart list in the MIUI sense.
     * What matters there is Device Care's battery policy, reached by action
     * rather than by component.
     */
    private val SAMSUNG_ACTIONS = listOf(
      "com.samsung.android.sm.ACTION_BATTERY",
      "com.samsung.android.sm.ACTION_APP_POWER_MANAGEMENT",
    )
  }

  override fun getName(): String = NAME

  // -------------------------------------------------------------------------
  // Battery optimisation
  // -------------------------------------------------------------------------

  /**
   * Is this app already exempt from Doze?
   *
   * Exposed separately so the UI can show a green tick instead of asking
   * someone to fix something that is already fixed. Nothing erodes trust in a
   * setup checklist faster than a step that stays unticked after you do it.
   */
  @ReactMethod
  fun isIgnoringBatteryOptimizations(promise: Promise) {
    try {
      val pm = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
      promise.resolve(pm.isIgnoringBatteryOptimizations(reactContext.packageName))
    } catch (e: Exception) {
      Log.w(TAG, "battery optimisation check failed", e)
      // Unknown, so report the state that prompts the user to check. A false
      // negative costs one unnecessary tap; a false positive costs protection.
      promise.resolve(false)
    }
  }

  /**
   * Ask Android to exempt ORBII from battery optimisation.
   *
   * REQUEST_IGNORE_BATTERY_OPTIMIZATIONS is a Play-policy-sensitive permission.
   * It is declared for one reason: a hands-free SOS listener that Doze can stop
   * is a listener that fails at 3am, which is the hour it exists for. That is
   * the justification given in the Play Console declaration, and this call is
   * only ever made from a screen where the user has asked for it.
   *
   * Resolves 'already' if there is nothing to do, so the UI need not ask twice.
   */
  @ReactMethod
  fun requestIgnoreBatteryOptimizations(promise: Promise) {
    try {
      val pm = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
      if (pm.isIgnoringBatteryOptimizations(reactContext.packageName)) {
        promise.resolve("already")
        return
      }
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
        data = Uri.parse("package:${reactContext.packageName}")
      }
      if (launch(intent)) {
        promise.resolve("requested")
      } else {
        // Some builds hide the direct request dialog. The general list still
        // works, it just costs the user a scroll.
        promise.resolve(
          if (launch(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))) "list"
          else if (openAppDetails()) "fallback"
          else "failed"
        )
      }
    } catch (e: Exception) {
      Log.w(TAG, "battery optimisation request failed", e)
      promise.resolve(if (openAppDetails()) "fallback" else "failed")
    }
  }

  // -------------------------------------------------------------------------
  // Autostart / background management
  // -------------------------------------------------------------------------

  /**
   * Open the vendor's autostart or background-management screen.
   *
   * Resolves with which route worked, so the screen can adapt its wording:
   *   "oem"      the real vendor page opened
   *   "samsung"  Device Care battery page opened
   *   "fallback" only the generic app details page opened
   *   "failed"   nothing resolved, which should be impossible
   */
  @ReactMethod
  fun openOemAutostartSettings(promise: Promise) {
    val brand = (Build.MANUFACTURER + " " + Build.BRAND).lowercase()

    val candidates: List<Pair<String, String>> = when {
      brand.contains("xiaomi") || brand.contains("redmi") || brand.contains("poco") -> XIAOMI
      // Realme and OnePlus both ship ColorOS derivatives, so they share OPPO's
      // component names. OnePlus on older OxygenOS resolves nothing here and
      // falls through to app details, which is correct: it had no such screen.
      brand.contains("oppo") || brand.contains("realme") || brand.contains("oneplus") -> OPPO
      brand.contains("vivo") || brand.contains("iqoo") -> VIVO
      brand.contains("huawei") || brand.contains("honor") -> HUAWEI
      brand.contains("letv") -> LETV
      brand.contains("asus") -> ASUS
      brand.contains("samsung") -> emptyList() // handled by action below
      else -> emptyList()
    }

    for ((pkg, cls) in candidates) {
      val intent = Intent().apply { component = ComponentName(pkg, cls) }
      if (launch(intent)) {
        promise.resolve("oem")
        return
      }
    }

    if (brand.contains("samsung")) {
      for (action in SAMSUNG_ACTIONS) {
        if (launch(Intent(action))) {
          promise.resolve("samsung")
          return
        }
      }
    }

    // Stock Android, an unknown vendor, or a renamed component. App details
    // always resolves and is one tap from the battery policy on every build.
    promise.resolve(if (openAppDetails()) "fallback" else "failed")
  }

  /** The app's own settings page. The one route that is always available. */
  @ReactMethod
  fun openAppSettings(promise: Promise) {
    promise.resolve(if (openAppDetails()) "fallback" else "failed")
  }

  /**
   * What we are running on, so the JS side can label the instructions without
   * a second native call or a guess from the user agent.
   */
  @ReactMethod
  fun getDeviceInfo(promise: Promise) {
    try {
      val map = com.facebook.react.bridge.Arguments.createMap().apply {
        putString("manufacturer", Build.MANUFACTURER ?: "")
        putString("brand", Build.BRAND ?: "")
        putString("model", Build.MODEL ?: "")
        putInt("sdk", Build.VERSION.SDK_INT)
      }
      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("device_info_failed", e)
    }
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  /**
   * Try to start an activity. Returns whether it actually started.
   *
   * resolveActivity is checked first because on several vendor builds an
   * unresolvable explicit component throws SecurityException rather than
   * ActivityNotFoundException, and one of those is not caught by the obvious
   * handler. Both are caught here anyway, because this must never be the
   * reason an app crashes.
   *
   * NEW_TASK is required: reactContext is an application context outside an
   * activity stack, and starting an activity from one without the flag throws.
   */
  private fun launch(intent: Intent): Boolean {
    return try {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      if (intent.resolveActivity(reactContext.packageManager) == null) return false
      val activity = reactContext.currentActivity
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        reactContext.applicationContext.startActivity(intent)
      }
      true
    } catch (e: ActivityNotFoundException) {
      Log.d(TAG, "no activity for ${intent.component ?: intent.action}")
      false
    } catch (e: SecurityException) {
      // The component exists but this app may not start it. Common on vendor
      // builds that expose the class but guard it with a signature permission.
      Log.d(TAG, "not permitted to start ${intent.component}", e)
      false
    } catch (e: Exception) {
      Log.w(TAG, "launch failed", e)
      false
    }
  }

  private fun openAppDetails(): Boolean {
    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
      data = Uri.parse("package:${reactContext.packageName}")
    }
    return launch(intent)
  }
}
