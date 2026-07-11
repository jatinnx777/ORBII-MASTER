package com.orbii.app.voice

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * A tiny, on-device noise-reduction front-end for the Voice SOS mic stream.
 *
 * WHAT IT DOES: band-limits the audio to the human-voice range before the
 * recognizer (and the VAD gate) ever sees it. Two cascaded biquad filters:
 *   • a high-pass at ~110 Hz removes low-frequency environmental energy —
 *     traffic rumble, wind, handling/pocket-rub, air-conditioning, engines.
 *     This is the loudest part of most "noisy place" recordings and none of it
 *     is speech.
 *   • a low-pass at ~3800 Hz removes high-frequency hiss and clatter above the
 *     band where "help" / "bachao" actually live.
 * What's left is the voice band, so the same shout stands out far more against
 * street noise, and the VAD gate stops firing on rumble it used to mistake for
 * speech.
 *
 * WHAT IT DOES NOT DO: it cannot remove noise that sits INSIDE the voice band —
 * a crowd talking, a TV, babble. That needs a learned denoiser (RNNoise) or
 * spectral subtraction, which are the next step and must be validated on a real
 * device before they go anywhere near the SOS path.
 *
 * Deterministic and cheap (a handful of multiplies per sample), so it's safe to
 * run on every frame. Fail-safe: any error leaves the audio untouched.
 */
class VoiceDenoiser(sampleRate: Int) {

  private val highPass = Biquad.highPass(sampleRate, 110.0, 0.707)
  // Never above Nyquist; at 16 kHz the ceiling is 8 kHz, 3800 is well under.
  private val lowPass = Biquad.lowPass(sampleRate, 3800.0, 0.707)

  /** Filter `n` samples of `buf` in place. On any error, `buf` is left as-is. */
  fun process(buf: ShortArray, n: Int) {
    try {
      for (i in 0 until n) {
        var s = buf[i].toDouble()
        s = highPass.step(s)
        s = lowPass.step(s)
        buf[i] = when {
          s > Short.MAX_VALUE -> Short.MAX_VALUE
          s < Short.MIN_VALUE -> Short.MIN_VALUE
          else -> s.toInt().toShort()
        }
      }
    } catch (_: Exception) {
      // Leave the buffer untouched rather than risk feeding garbage to the SOS.
    }
  }

  /** Clear filter memory so a new session doesn't inherit the last one's tail. */
  fun reset() {
    highPass.reset()
    lowPass.reset()
  }
}

/**
 * A single second-order IIR section (RBJ "audio EQ cookbook" coefficients),
 * Direct Form I. State is carried between calls so it filters a continuous
 * stream one sample at a time.
 */
private class Biquad(
  private val b0: Double,
  private val b1: Double,
  private val b2: Double,
  private val a1: Double,
  private val a2: Double,
) {
  private var x1 = 0.0
  private var x2 = 0.0
  private var y1 = 0.0
  private var y2 = 0.0

  fun step(x: Double): Double {
    val y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1; x1 = x
    y2 = y1; y1 = y
    return y
  }

  fun reset() {
    x1 = 0.0; x2 = 0.0; y1 = 0.0; y2 = 0.0
  }

  companion object {
    fun highPass(fs: Int, f0: Double, q: Double): Biquad {
      val w0 = 2.0 * PI * f0 / fs
      val cw = cos(w0)
      val alpha = sin(w0) / (2.0 * q)
      val a0 = 1.0 + alpha
      return Biquad(
        b0 = ((1.0 + cw) / 2.0) / a0,
        b1 = (-(1.0 + cw)) / a0,
        b2 = ((1.0 + cw) / 2.0) / a0,
        a1 = (-2.0 * cw) / a0,
        a2 = (1.0 - alpha) / a0,
      )
    }

    fun lowPass(fs: Int, f0: Double, q: Double): Biquad {
      val w0 = 2.0 * PI * f0 / fs
      val cw = cos(w0)
      val alpha = sin(w0) / (2.0 * q)
      val a0 = 1.0 + alpha
      return Biquad(
        b0 = ((1.0 - cw) / 2.0) / a0,
        b1 = (1.0 - cw) / a0,
        b2 = ((1.0 - cw) / 2.0) / a0,
        a1 = (-2.0 * cw) / a0,
        a2 = (1.0 - alpha) / a0,
      )
    }
  }
}
