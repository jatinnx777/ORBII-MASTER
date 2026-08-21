package com.orbii.app.voice

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaRecorder
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Packages the audio around an SOS into one encrypted evidence file.
 *
 * WHAT IT PRODUCES: a single M4A containing 15 seconds from BEFORE the trigger
 * (already in PreRollBuffer) followed by 30 seconds recorded after it, AAC-LC
 * encoded, then encrypted with AES-256-GCM at rest, with a SHA-256 over the
 * plaintext so the file can be shown to be unaltered later.
 *
 * WHY PRE-ROLL MATTERS MORE THAN THE REST. Recording that starts at the trigger
 * begins at the moment she shouts, and everything that led to it, the
 * footsteps, what he said, the car door, is gone. The buffer already holds it.
 * This is what finally writes it down.
 *
 * THREE THINGS THIS FILE REFUSES TO DO:
 *
 *   1. Block the SOS. Every entry point returns null on failure and logs. An
 *      SOS must fire whether or not evidence encoding worked, and encoding runs
 *      after the alert has already gone out.
 *
 *   2. Hold the mic exclusively. VoiceGuardService owns the AudioRecord and is
 *      still listening for a second trigger. Opening a second recorder can fail
 *      outright or, worse, silently steal the stream on some OEMs and deafen
 *      Voice SOS during an active emergency. So the post-trigger audio is FED
 *      IN by the service through `appendPcm` from the frames it is already
 *      reading, and `recordPostTrigger` exists only for callers that own a mic.
 *
 *   3. Leave plaintext on disk. The M4A is written to cacheDir, encrypted into
 *      filesDir, and the plaintext deleted. A phone that ends up in the wrong
 *      hands should not carry a clear recording of the worst minute of
 *      somebody's life.
 *
 * ON THE KEY. The AES key is generated per file and returned to the caller
 * base64-encoded, to be sealed into the SOS dispatch payload the same way the
 * mesh seals its packets. It is deliberately NOT persisted next to the
 * ciphertext: a key stored beside the thing it protects is decoration. If the
 * caller loses it, the recording is unrecoverable, and that is the correct
 * trade for this data.
 */
object AudioEvidenceEncoder {

  private const val TAG = "AudioEvidence"

  private const val MIME = MediaFormat.MIMETYPE_AUDIO_AAC   // audio/mp4a-latm
  private const val BIT_RATE = 32_000                        // mono speech, plenty
  private const val CHANNELS = 1
  private const val CODEC_TIMEOUT_US = 10_000L

  /** Post-trigger capture length. */
  const val POST_TRIGGER_MS = 30_000

  const val GCM_TAG_BITS = 128
  const val GCM_IV_BYTES = 12

  data class Evidence(
    /** Encrypted file on disk. */
    val file: File,
    /** SHA-256 of the PLAINTEXT m4a, hex. Proves the audio, not the ciphertext. */
    val sha256: String,
    /**
     * Raw AES-256 key, 32 bytes. Seal it for the recipients, then call
     * [wipeKey] on it.
     *
     * A ByteArray rather than a base64 String on purpose. A String is immutable
     * and interned by the JVM: once the key exists as one there is no way to
     * erase it, and it stays in the heap until a GC that may never come during
     * the emergency. Bytes can be overwritten in place, which is the only
     * version of "wipe the key from memory" that is not theatre.
     */
    val key: ByteArray,
    /** GCM IV, 12 bytes. Safe to store beside the file, useless on its own. */
    val iv: ByteArray,
    val durationMs: Int,
  ) {
    /** Base64 IV, for putting in a payload. The IV is not a secret. */
    fun ivB64(): String = android.util.Base64.encodeToString(iv, android.util.Base64.NO_WRAP)

    // Value semantics on arrays, so equals/hashCode do not compare references.
    override fun equals(other: Any?): Boolean =
      this === other || (other is Evidence && file == other.file && sha256 == other.sha256)

    override fun hashCode(): Int = 31 * file.hashCode() + sha256.hashCode()
  }

  /**
   * Overwrite a key in place. Call as soon as the envelopes are sealed.
   *
   * Honest about the limit: this erases THIS array. It cannot erase a copy the
   * runtime made behind your back, and SecretKey.getEncoded() hands out a clone
   * every call, so the discipline is to take the bytes once and never convert
   * them to a String.
   */
  @JvmStatic
  fun wipeKey(key: ByteArray) {
    java.util.Arrays.fill(key, 0.toByte())
  }

  // ---------------------------------------------------------------------------
  // Public entry points
  // ---------------------------------------------------------------------------

  /**
   * Encode pre-roll plus already-captured post-trigger PCM into one encrypted
   * file. This is the path VoiceGuardService uses, because it already owns the
   * microphone and can hand over the frames it is reading anyway.
   *
   * @param preRoll  samples from before the trigger, oldest first
   * @param post     samples captured after it, may be empty
   */
  @JvmStatic
  fun encode(
    dir: File,
    baseName: String,
    sampleRate: Int,
    preRoll: ShortArray,
    post: ShortArray,
  ): Evidence? {
    if (preRoll.isEmpty() && post.isEmpty()) return null
    return try {
      val plain = File(dir.also { it.mkdirs() }, "$baseName.m4a")
      val total = encodeToM4a(plain, sampleRate, preRoll, post) ?: return null
      val sha = sha256Of(plain)
      val enc = encryptInPlace(plain, File(dir, "$baseName.m4a.enc")) ?: return null
      Evidence(
        file = enc.first,
        sha256 = sha,
        key = enc.second,
        iv = enc.third,
        durationMs = total,
      )
    } catch (e: Exception) {
      Log.w(TAG, "evidence encode failed", e)
      null
    }
  }

  /**
   * Open a second microphone stream for POST_TRIGGER_MS and encode alongside
   * the pre-roll.
   *
   * ONLY for callers that do not already hold the mic. VoiceGuardService must
   * not use this: two AudioRecords on one device is unreliable across OEMs and
   * on some of them the second one silently wins, which would leave Voice SOS
   * deaf during an active emergency. Use `encode` and feed frames instead.
   *
   * Blocking, ~30 s. Call it off the main thread and after the alert has fired.
   */
  @JvmStatic
  fun recordPostTrigger(
    dir: File,
    baseName: String,
    sampleRate: Int,
    preRoll: ShortArray,
  ): Evidence? {
    val post = try {
      capture(sampleRate, POST_TRIGGER_MS)
    } catch (e: SecurityException) {
      Log.w(TAG, "mic permission missing for post-trigger capture", e)
      ShortArray(0)
    } catch (e: Exception) {
      Log.w(TAG, "post-trigger capture failed", e)
      ShortArray(0)
    }
    // Even with no post audio the pre-roll alone is worth keeping.
    return encode(dir, baseName, sampleRate, preRoll, post)
  }

  // ---------------------------------------------------------------------------
  // Capture
  // ---------------------------------------------------------------------------

  private fun capture(sampleRate: Int, ms: Int): ShortArray {
    val min = AudioRecord.getMinBufferSize(
      sampleRate,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
    )
    if (min <= 0) return ShortArray(0)

    val record = AudioRecord(
      MediaRecorder.AudioSource.MIC,
      sampleRate,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
      min * 2,
    )
    if (record.state != AudioRecord.STATE_INITIALIZED) {
      record.release()
      return ShortArray(0)
    }

    val wanted = sampleRate * ms / 1000
    val out = ShortArray(wanted)
    var got = 0
    return try {
      record.startRecording()
      val deadline = System.currentTimeMillis() + ms + 2000
      val frame = ShortArray(sampleRate / 5) // 200 ms
      while (got < wanted && System.currentTimeMillis() < deadline) {
        val n = record.read(frame, 0, frame.size)
        if (n <= 0) continue
        val take = minOf(n, wanted - got)
        System.arraycopy(frame, 0, out, got, take)
        got += take
      }
      if (got == wanted) out else out.copyOf(got)
    } finally {
      try { record.stop() } catch (_: Exception) {}
      record.release()
    }
  }

  // ---------------------------------------------------------------------------
  // AAC encode
  // ---------------------------------------------------------------------------

  /**
   * Stream PCM through MediaCodec into an MP4 container. Returns duration in ms.
   *
   * The two arrays are encoded back to back with one continuous presentation
   * timeline, so the result plays as a single unbroken clip across the trigger
   * rather than two files somebody has to line up afterwards.
   */
  private fun encodeToM4a(
    out: File,
    sampleRate: Int,
    preRoll: ShortArray,
    post: ShortArray,
  ): Int? {
    var codec: MediaCodec? = null
    var muxer: MediaMuxer? = null
    var track = -1
    var muxing = false

    return try {
      val format = MediaFormat.createAudioFormat(MIME, sampleRate, CHANNELS).apply {
        setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
        setInteger(MediaFormat.KEY_BIT_RATE, BIT_RATE)
        // Large enough for a 200 ms frame of 16-bit mono at any rate we use.
        setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384)
      }

      codec = MediaCodec.createEncoderByType(MIME).apply {
        configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        start()
      }
      muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)

      val info = MediaCodec.BufferInfo()
      var presentationUs = 0L
      var samplesFed = 0L

      // Feed both arrays as one stream.
      val sources = listOf(preRoll, post)
      var srcIndex = 0
      var srcOffset = 0
      var endOfStreamSent = false

      while (true) {
        if (!endOfStreamSent) {
          val inIndex = codec.dequeueInputBuffer(CODEC_TIMEOUT_US)
          if (inIndex >= 0) {
            val buf: ByteBuffer = codec.getInputBuffer(inIndex)!!
            buf.clear()

            // Skip past any exhausted or empty source.
            while (srcIndex < sources.size && srcOffset >= sources[srcIndex].size) {
              srcIndex++
              srcOffset = 0
            }

            if (srcIndex >= sources.size) {
              codec.queueInputBuffer(
                inIndex, 0, 0, presentationUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM,
              )
              endOfStreamSent = true
            } else {
              val src = sources[srcIndex]
              val room = buf.remaining() / 2
              val take = minOf(room, src.size - srcOffset)
              val shorts = buf.order(ByteOrder.nativeOrder()).asShortBuffer()
              shorts.put(src, srcOffset, take)
              srcOffset += take
              samplesFed += take
              codec.queueInputBuffer(inIndex, 0, take * 2, presentationUs, 0)
              presentationUs = samplesFed * 1_000_000L / sampleRate
            }
          }
        }

        val outIndex = codec.dequeueOutputBuffer(info, CODEC_TIMEOUT_US)
        when {
          outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            // Must happen exactly once, before any sample is written.
            track = muxer.addTrack(codec.outputFormat)
            muxer.start()
            muxing = true
          }
          outIndex >= 0 -> {
            val encoded = codec.getOutputBuffer(outIndex)!!
            // Codec config bytes belong in the track format, not the stream.
            if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
              info.size = 0
            }
            if (info.size > 0 && muxing) {
              encoded.position(info.offset)
              encoded.limit(info.offset + info.size)
              muxer.writeSampleData(track, encoded, info)
            }
            codec.releaseOutputBuffer(outIndex, false)
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
          }
        }
      }

      (samplesFed * 1000L / sampleRate).toInt()
    } catch (e: Exception) {
      Log.w(TAG, "aac encode failed", e)
      null
    } finally {
      try { codec?.stop() } catch (_: Exception) {}
      try { codec?.release() } catch (_: Exception) {}
      if (muxing) { try { muxer?.stop() } catch (_: Exception) {} }
      try { muxer?.release() } catch (_: Exception) {}
    }
  }

  // ---------------------------------------------------------------------------
  // Hash and encryption
  // ---------------------------------------------------------------------------

  /** SHA-256 over the PLAINTEXT m4a. Streamed, so a long clip is not held twice. */
  private fun sha256Of(f: File): String {
    val md = MessageDigest.getInstance("SHA-256")
    f.inputStream().use { ins ->
      val buf = ByteArray(64 * 1024)
      while (true) {
        val n = ins.read(buf)
        if (n <= 0) break
        md.update(buf, 0, n)
      }
    }
    return md.digest().joinToString("") { "%02x".format(it) }
  }

  /**
   * AES-256-GCM the file, delete the plaintext, return (ciphertext, key, iv).
   *
   * GCM rather than CBC because it authenticates as well as encrypts: a
   * tampered evidence file fails to decrypt rather than decrypting to something
   * subtly different, which is the property that matters for evidence.
   *
   * A fresh random IV per file. Reusing an IV under one key with GCM is
   * catastrophic, not merely weak, so it is generated here and never derived.
   */
  private fun encryptInPlace(plain: File, dest: File): Triple<File, ByteArray, ByteArray>? {
    return try {
      val key: SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
      // Taken ONCE. getEncoded() returns a fresh clone on every call, so asking
      // twice would leave a second copy on the heap that nobody can wipe.
      val keyBytes = key.encoded
      val iv = ByteArray(GCM_IV_BYTES).also { SecureRandom().nextBytes(it) }

      val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
        init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
      }

      FileOutputStream(dest).use { fos ->
        plain.inputStream().use { ins ->
          val buf = ByteArray(64 * 1024)
          while (true) {
            val n = ins.read(buf)
            if (n <= 0) break
            cipher.update(buf, 0, n)?.let { fos.write(it) }
          }
          fos.write(cipher.doFinal())
        }
      }

      // The whole point. A clear recording left in cache defeats the exercise.
      if (!plain.delete()) {
        Log.w(TAG, "could not delete plaintext evidence, overwriting instead")
        FileOutputStream(plain).use { it.write(ByteArray(1)) }
        plain.delete()
      }

      Triple(dest, keyBytes, iv)
    } catch (e: Exception) {
      Log.w(TAG, "encryption failed", e)
      // Never leave plaintext behind because the encryption step failed.
      try { plain.delete() } catch (_: Exception) {}
      null
    }
  }

  /** Decrypt, for playback in the app. Returns a temp plaintext file. */
  @JvmStatic
  fun decrypt(enc: File, keyB64: String, ivB64: String, dest: File): File? {
    return try {
      val key = javax.crypto.spec.SecretKeySpec(
        android.util.Base64.decode(keyB64, android.util.Base64.NO_WRAP), "AES",
      )
      val iv = android.util.Base64.decode(ivB64, android.util.Base64.NO_WRAP)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
        init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
      }
      FileOutputStream(dest).use { fos ->
        enc.inputStream().use { ins ->
          val buf = ByteArray(64 * 1024)
          while (true) {
            val n = ins.read(buf)
            if (n <= 0) break
            cipher.update(buf, 0, n)?.let { fos.write(it) }
          }
          fos.write(cipher.doFinal())
        }
      }
      dest
    } catch (e: Exception) {
      // AEADBadTagException lands here: the file was altered or the key is wrong.
      Log.w(TAG, "decrypt failed", e)
      null
    }
  }
}
