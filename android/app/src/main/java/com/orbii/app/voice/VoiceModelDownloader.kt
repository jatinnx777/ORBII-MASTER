package com.orbii.app.voice

import android.content.Context
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.ZipInputStream

/**
 * Downloads + unpacks an optional Vosk language pack (currently Hindi) into the
 * app's private storage. Only used for languages that are NOT bundled in the
 * APK — English ships inside the app, Hindi is fetched on demand so the base
 * download stays small.
 *
 * Reports coarse progress through `onProgress` (0–100): 0–90 for the network
 * download, 90–100 for unzip. Everything lands in `filesDir/<dirName>/` with
 * the model's top-level folder stripped, matching what VoiceGuardService loads.
 */
object VoiceModelDownloader {
  private const val TAG = "VoiceGuard"

  @Throws(Exception::class)
  fun download(
    ctx: Context,
    url: String,
    dirName: String,
    onProgress: (Int) -> Unit,
  ) {
    val outDir = File(ctx.filesDir, dirName)
    // Already unpacked? Nothing to do.
    if (File(outDir, "conf").exists()) {
      onProgress(100)
      return
    }
    outDir.deleteRecursively()
    outDir.mkdirs()

    val tmp = File(ctx.cacheDir, "$dirName.zip")
    tmp.delete()

    // ── download with progress ──────────────────────────────
    val conn = (URL(url).openConnection() as HttpURLConnection).apply {
      connectTimeout = 30_000
      readTimeout = 30_000
      instanceFollowRedirects = true
    }
    try {
      conn.connect()
      val total = conn.contentLength.toLong() // -1 if unknown
      conn.inputStream.use { input ->
        FileOutputStream(tmp).use { out ->
          val buf = ByteArray(1 shl 16)
          var read: Int
          var downloaded = 0L
          var lastPct = -1
          while (input.read(buf).also { read = it } != -1) {
            out.write(buf, 0, read)
            downloaded += read
            if (total > 0) {
              val pct = ((downloaded * 90) / total).toInt()
              if (pct != lastPct) {
                lastPct = pct
                onProgress(pct.coerceIn(0, 90))
              }
            }
          }
        }
      }
    } finally {
      conn.disconnect()
    }

    // ── unzip (strip the top-level model folder) ────────────
    onProgress(90)
    ZipInputStream(tmp.inputStream()).use { zip ->
      var entry = zip.nextEntry
      while (entry != null) {
        val rel = entry.name.substringAfter('/')
        if (rel.isNotEmpty()) {
          val outFile = File(outDir, rel)
          if (entry.isDirectory) {
            outFile.mkdirs()
          } else {
            outFile.parentFile?.mkdirs()
            FileOutputStream(outFile).use { fos -> zip.copyTo(fos, 1 shl 16) }
          }
        }
        entry = zip.nextEntry
      }
    }
    tmp.delete()

    if (!File(outDir, "conf").exists()) {
      Log.e(TAG, "downloaded pack missing conf/ — corrupt?")
      outDir.deleteRecursively()
      throw IllegalStateException("Language pack unpacked incorrectly")
    }
    onProgress(100)
  }
}
