package com.orbii.app.voice

import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * A rolling window of the most recent raw microphone audio.
 *
 * WHY THIS EXISTS: SOS recording only starts *after* the trigger fires, so the
 * clip begins at the moment she shouts "help help" — and everything that led up
 * to it (the threat, the footsteps, what he said) is gone forever. The engine
 * already streams PCM through this service for ASR, so keeping the last N
 * seconds costs one small array and makes the evidence start *before* the
 * emergency.
 *
 * Fixed-size circular buffer of 16-bit mono PCM. Writes are O(n) memcpy, never
 * allocate, and are safe to call on the audio thread every frame — including
 * during silence, which is precisely the part we want to keep.
 *
 * 15s @ 16 kHz mono 16-bit = 480,000 bytes (~470 KB). Cheap.
 */
class PreRollBuffer(private val sampleRate: Int, seconds: Int) {

  companion object {
    private const val TAG = "PreRoll"
  }

  private val capacity = sampleRate * seconds
  private val ring = ShortArray(capacity)
  private var writeIndex = 0
  /** Total samples ever written; tells us whether the ring has wrapped. */
  private var written = 0L

  /** Append `n` samples. Called every audio frame, silence included. */
  @Synchronized
  fun write(src: ShortArray, n: Int) {
    if (n <= 0) return
    var offset = 0
    var remaining = minOf(n, src.size)
    // If a single frame is somehow larger than the ring, keep only its tail.
    if (remaining > capacity) {
      offset = remaining - capacity
      remaining = capacity
    }
    var chunk = minOf(remaining, capacity - writeIndex)
    System.arraycopy(src, offset, ring, writeIndex, chunk)
    writeIndex = (writeIndex + chunk) % capacity
    var left = remaining - chunk
    if (left > 0) {
      System.arraycopy(src, offset + chunk, ring, 0, left)
      writeIndex = left % capacity
    }
    written += remaining
  }

  /**
   * Snapshot of the window, oldest sample first.
   *
   * Public so AudioEvidenceEncoder can feed the pre-trigger seconds straight
   * into MediaCodec instead of round-tripping through a WAV on disk. The WAV
   * path (dumpWav) stays for the debug screen, which wants a file it can play.
   *
   * Returns a copy, so the caller can hold it while the ring keeps filling.
   * 15 s is 480,000 samples, a 960 KB allocation. That is worth it once, at the
   * moment of an SOS, to avoid encoding from a buffer that is being overwritten
   * underneath us.
   */
  @Synchronized
  fun readPcm(): ShortArray = snapshot()

  /** Sample rate this buffer was created with, for the encoder's format. */
  fun sampleRate(): Int = sampleRate

  /** Snapshot of the window, oldest sample first. */
  @Synchronized
  private fun snapshot(): ShortArray {
    val size = if (written >= capacity) capacity else written.toInt()
    if (size == 0) return ShortArray(0)
    val out = ShortArray(size)
    if (written < capacity) {
      System.arraycopy(ring, 0, out, 0, size)
    } else {
      val tail = capacity - writeIndex
      System.arraycopy(ring, writeIndex, out, 0, tail)
      System.arraycopy(ring, 0, out, tail, writeIndex)
    }
    return out
  }

  /**
   * Write the window to a 16-bit mono WAV. Returns the file, or null on
   * failure — a failed pre-roll must never stop an SOS from firing.
   */
  @Synchronized
  fun dumpWav(dir: File, name: String): File? {
    return try {
      val samples = snapshot()
      if (samples.isEmpty()) return null
      if (!dir.exists()) dir.mkdirs()
      val out = File(dir, name)
      FileOutputStream(out).use { fos ->
        val dataBytes = samples.size * 2
        fos.write(wavHeader(dataBytes))
        // 16-bit little-endian PCM.
        val bb = ByteBuffer.allocate(dataBytes).order(ByteOrder.LITTLE_ENDIAN)
        for (s in samples) bb.putShort(s)
        fos.write(bb.array())
      }
      out
    } catch (e: Exception) {
      Log.w(TAG, "pre-roll dump failed", e)
      null
    }
  }

  private fun wavHeader(dataBytes: Int): ByteArray {
    val byteRate = sampleRate * 2 // mono, 16-bit
    val bb = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
    bb.put("RIFF".toByteArray())
    bb.putInt(36 + dataBytes)
    bb.put("WAVE".toByteArray())
    bb.put("fmt ".toByteArray())
    bb.putInt(16)          // PCM subchunk size
    bb.putShort(1)         // audio format = PCM
    bb.putShort(1)         // channels = mono
    bb.putInt(sampleRate)
    bb.putInt(byteRate)
    bb.putShort(2)         // block align
    bb.putShort(16)        // bits per sample
    bb.put("data".toByteArray())
    bb.putInt(dataBytes)
    return bb.array()
  }
}
