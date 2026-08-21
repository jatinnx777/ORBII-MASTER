package com.orbii.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.orbii.app.voice.AudioEvidenceEncoder
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import kotlin.math.PI
import kotlin.math.sin

/**
 * Instrumented, not a JVM unit test, and it has to be.
 *
 * MediaCodec, MediaMuxer and android.util.Base64 are framework classes with no
 * implementation on a desktop JVM. Running these as local unit tests would
 * either need Robolectric shadows, which do not implement a real codec, or
 * would silently pass against stubs. Encoding is exactly the part where the
 * chipset matters, so the test runs on a device.
 *
 *   ./gradlew :app:connectedDebugAndroidTest
 */
@RunWith(AndroidJUnit4::class)
class AudioEvidenceTest {

  private lateinit var dir: File
  private val sampleRate = 16_000

  @Before
  fun setUp() {
    val ctx = InstrumentationRegistry.getInstrumentation().targetContext
    dir = File(ctx.cacheDir, "evidence-test").apply {
      deleteRecursively()
      mkdirs()
    }
  }

  @After
  fun tearDown() {
    dir.deleteRecursively()
  }

  /** A second of audible tone, so the encoder has real signal, not silence. */
  private fun tone(seconds: Int, hz: Double = 440.0): ShortArray {
    val n = sampleRate * seconds
    return ShortArray(n) { i ->
      (sin(2.0 * PI * hz * i / sampleRate) * 8000).toInt().toShort()
    }
  }

  // ---------------------------------------------------------------------------

  @Test
  fun plaintext_m4a_is_deleted_after_encryption() {
    val ev = AudioEvidenceEncoder.encode(
      dir = dir,
      baseName = "case1",
      sampleRate = sampleRate,
      preRoll = tone(2),
      post = tone(1, 660.0),
    )
    assertNotNull("encoder returned null on a device that should support AAC", ev)
    ev!!

    assertTrue("ciphertext missing", ev.file.exists())
    assertTrue("ciphertext is empty", ev.file.length() > 0)

    // The point of the whole exercise: no clear recording left behind.
    val plain = File(dir, "case1.m4a")
    assertFalse("PLAINTEXT M4A STILL ON DISK at ${plain.absolutePath}", plain.exists())

    // And nothing else in the directory is an unencrypted media file.
    val stray = dir.listFiles()?.filter {
      it.name.endsWith(".m4a") || it.name.endsWith(".wav") || it.name.endsWith(".pcm")
    }.orEmpty()
    assertTrue("unencrypted audio left behind: ${stray.map { it.name }}", stray.isEmpty())

    AudioEvidenceEncoder.wipeKey(ev.key)
  }

  @Test
  fun round_trip_decrypts_to_a_playable_file() {
    val ev = AudioEvidenceEncoder.encode(dir, "case2", sampleRate, tone(2), ShortArray(0))!!
    val keyB64 = android.util.Base64.encodeToString(ev.key, android.util.Base64.NO_WRAP)

    val out = File(dir, "case2-decrypted.m4a")
    val got = AudioEvidenceEncoder.decrypt(ev.file, keyB64, ev.ivB64(), out)

    assertNotNull("correct key and IV failed to decrypt", got)
    assertTrue(out.length() > 0)
    // MP4 files carry 'ftyp' at bytes 4..7. Proves we got media back, not noise.
    val head = out.readBytes().copyOfRange(4, 8).toString(Charsets.US_ASCII)
    assertEquals("decrypted output is not an MP4", "ftyp", head)

    AudioEvidenceEncoder.wipeKey(ev.key)
  }

  @Test
  fun tampered_ciphertext_fails_and_does_not_return_partial_audio() {
    val ev = AudioEvidenceEncoder.encode(dir, "case3", sampleRate, tone(2), ShortArray(0))!!
    val keyB64 = android.util.Base64.encodeToString(ev.key, android.util.Base64.NO_WRAP)

    // Flip one bit in the middle of the ciphertext.
    val bytes = ev.file.readBytes()
    bytes[bytes.size / 2] = (bytes[bytes.size / 2].toInt() xor 0x01).toByte()
    ev.file.writeBytes(bytes)

    val out = File(dir, "case3-decrypted.m4a")
    val got = AudioEvidenceEncoder.decrypt(ev.file, keyB64, ev.ivB64(), out)

    // GCM authenticates. One flipped bit must fail the tag, not decrypt to
    // something subtly different, which is the entire reason it is GCM and not
    // CBC. Failing gracefully means null and no exception escaping.
    assertNull("tampered ciphertext decrypted, GCM tag not enforced", got)

    AudioEvidenceEncoder.wipeKey(ev.key)
  }

  @Test
  fun wrong_iv_fails_gracefully() {
    val ev = AudioEvidenceEncoder.encode(dir, "case4", sampleRate, tone(2), ShortArray(0))!!
    val keyB64 = android.util.Base64.encodeToString(ev.key, android.util.Base64.NO_WRAP)

    val badIv = ByteArray(AudioEvidenceEncoder.GCM_IV_BYTES) { 0x7 }
    val badIvB64 = android.util.Base64.encodeToString(badIv, android.util.Base64.NO_WRAP)

    val out = File(dir, "case4-decrypted.m4a")
    assertNull(
      "decryption succeeded with the wrong IV",
      AudioEvidenceEncoder.decrypt(ev.file, keyB64, badIvB64, out),
    )

    AudioEvidenceEncoder.wipeKey(ev.key)
  }

  /**
   * Named exactly for what it proves.
   *
   * It asserts that OUR ByteArray is zeroed. It does NOT and cannot prove the
   * key is absent from process memory: the JVM may hold copies we never see,
   * SecretKey.getEncoded() hands out a fresh clone on each call, and any
   * base64 String made from these bytes is immutable and unreachable to
   * Arrays.fill. Wiping the array we own is worth doing and is the only part
   * that can be tested; a test claiming more than that would be false comfort.
   */
  @Test
  fun verifies_local_key_byte_array_reference_is_zeroed() {
    val ev = AudioEvidenceEncoder.encode(dir, "case5", sampleRate, tone(1), ShortArray(0))!!

    assertEquals("expected a 256-bit key", 32, ev.key.size)
    assertTrue("key was already all zeroes before wiping", ev.key.any { it != 0.toByte() })

    AudioEvidenceEncoder.wipeKey(ev.key)

    assertTrue("key bytes not zeroed", ev.key.all { it == 0.toByte() })
  }

  @Test
  fun preroll_and_post_encode_as_one_continuous_clip() {
    val preSeconds = 3
    val postSeconds = 2
    val ev = AudioEvidenceEncoder.encode(
      dir, "case6", sampleRate, tone(preSeconds), tone(postSeconds, 660.0),
    )!!

    // Duration must reflect BOTH segments. A result near preSeconds alone means
    // the post-trigger audio was dropped rather than appended, which is the bug
    // this catches: two clips somebody has to line up instead of one.
    val expected = (preSeconds + postSeconds) * 1000
    assertTrue(
      "expected ~${expected}ms across both segments, got ${ev.durationMs}ms",
      ev.durationMs > expected - 400 && ev.durationMs < expected + 400,
    )

    AudioEvidenceEncoder.wipeKey(ev.key)
  }

  @Test
  fun empty_input_returns_null_rather_than_an_empty_file() {
    assertNull(
      AudioEvidenceEncoder.encode(dir, "case7", sampleRate, ShortArray(0), ShortArray(0)),
    )
  }

  @Test
  fun each_file_gets_a_distinct_key_and_iv() {
    val a = AudioEvidenceEncoder.encode(dir, "case8a", sampleRate, tone(1), ShortArray(0))!!
    val b = AudioEvidenceEncoder.encode(dir, "case8b", sampleRate, tone(1), ShortArray(0))!!

    // IV reuse under one key with GCM is catastrophic rather than merely weak,
    // so this is a correctness test, not a style one.
    assertFalse("IV reused across files", a.iv.contentEquals(b.iv))
    assertFalse("key reused across files", a.key.contentEquals(b.key))

    AudioEvidenceEncoder.wipeKey(a.key)
    AudioEvidenceEncoder.wipeKey(b.key)
  }
}
