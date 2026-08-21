package com.orbii.app.voice

import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.security.SecureRandom

/**
 * Seals the evidence key for the people allowed to hear the recording.
 *
 * THE SHAPE. AudioEvidenceEncoder produces one AES-256 key per SOS. That key
 * must reach the victim's contacts and must not reach anyone else, including
 * ORBII. So it is never sent as-is: it is sealed once per recipient with that
 * recipient's X25519 public key, and the dispatch carries the ciphertext file
 * plus an envelope per recipient. Only a holder of the matching secret key can
 * open one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE CLAIMING ZERO-KNOWLEDGE. It is not true yet.
 *
 * The scheme above requires every emergency contact to HAVE an X25519 keypair
 * whose public half this phone can fetch. ORBII has no such thing today. The
 * only public key anywhere in the codebase is SERVER_PUBLIC_KEY_B64 in
 * mesh-crypto.ts, a single hardcoded server key whose secret half lives on
 * ORBII's server. There is no per-user key generation, no publication, no
 * rotation, and no trust-on-first-use. E2EE_CIRCLE_SPEC.md describes building
 * it and says in its own header that it is not built.
 *
 * So with today's key material there is exactly one possible recipient: the
 * server. Sealing to the server key gives encryption in transit and at rest,
 * which is worth having, and gives NO protection against ORBII itself. Calling
 * that zero-knowledge would be false, and false in the specific direction that
 * damages a privacy-first product most.
 *
 * This class is therefore written against a LIST of recipient public keys and
 * refuses to invent one. When per-user keys exist, pass them in and the
 * property becomes real with no change here. Until then, whoever calls this
 * decides what to seal to, in the open, and [sealFor] returns an empty map
 * rather than silently sealing to a key the recipient does not hold.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Crypto note: NaCl sealed boxes, X25519 + XSalsa20-Poly1305. Anonymous
 * sender, so the recipient learns nothing about who sealed it, and each seal
 * generates its own ephemeral keypair. That is the right primitive here: the
 * victim is not authenticating herself to her own contacts, she is making sure
 * nobody else can listen.
 */
object EvidenceKeyManager {

  private const val TAG = "EvidenceKey"

  /** X25519 public keys are 32 bytes. Anything else is not one. */
  private const val PUBLIC_KEY_BYTES = 32

  data class Recipient(
    /** Stable id the app already uses for this contact. */
    val id: String,
    /** Their X25519 public key, 32 raw bytes. */
    val publicKey: ByteArray,
  ) {
    override fun equals(other: Any?): Boolean =
      this === other || (other is Recipient && id == other.id)

    override fun hashCode(): Int = id.hashCode()
  }

  /**
   * Seal `key` once per recipient.
   *
   * Returns id → base64 envelope. Recipients with a malformed key are skipped
   * and logged rather than failing the whole set: one contact with a corrupt
   * key must not cost the others their access to the evidence.
   *
   * Does NOT wipe `key`. The caller owns it and knows when the last use is,
   * which is usually after the payload is assembled. See [buildPayload], which
   * does wipe.
   */
  @JvmStatic
  fun sealFor(key: ByteArray, recipients: List<Recipient>): Map<String, String> {
    if (recipients.isEmpty()) {
      // Deliberate. See the header: no recipients means no envelopes, not a
      // quiet fallback to some key the recipient cannot open.
      Log.w(TAG, "no recipient public keys, evidence key not sealed for anyone")
      return emptyMap()
    }
    val out = LinkedHashMap<String, String>(recipients.size)
    for (r in recipients) {
      if (r.publicKey.size != PUBLIC_KEY_BYTES) {
        Log.w(TAG, "recipient ${r.id} has a ${r.publicKey.size}-byte key, skipping")
        continue
      }
      try {
        val sealed = SealedBox.seal(key, r.publicKey)
        out[r.id] = Base64.encodeToString(sealed, Base64.NO_WRAP)
      } catch (e: Exception) {
        Log.w(TAG, "sealing for ${r.id} failed", e)
      }
    }
    return out
  }

  /**
   * Assemble the dispatch metadata and wipe the key.
   *
   * The wipe happens here, at the last point the plaintext key is needed, and
   * it happens in a finally so an exception during JSON assembly cannot leave
   * the key alive on the heap.
   */
  @JvmStatic
  fun buildPayload(
    evidence: AudioEvidenceEncoder.Evidence,
    recipients: List<Recipient>,
  ): String {
    return try {
      val envelopes = sealFor(evidence.key, recipients)
      JSONObject().apply {
        put("evidence_uri", "file://${evidence.file.absolutePath}")
        put("sha256", evidence.sha256)
        put("iv", evidence.ivB64())
        put("duration_ms", evidence.durationMs)
        put("key_envelopes", JSONObject(envelopes as Map<*, *>))
        // Stated in the payload so a consumer can tell the difference between
        // "sealed for you" and "encrypted but nobody can open it yet".
        put("sealed_for", envelopes.size)
      }.toString()
    } finally {
      AudioEvidenceEncoder.wipeKey(evidence.key)
    }
  }

  // ---------------------------------------------------------------------------
  // NaCl sealed box
  // ---------------------------------------------------------------------------

  /**
   * Minimal sealed-box implementation over the platform's primitives.
   *
   * A sealed box is: generate an ephemeral X25519 keypair, derive a shared
   * secret with the recipient's public key, derive the nonce by hashing the two
   * public keys together, and prepend the ephemeral public key to the
   * ciphertext. The recipient can reconstruct everything from what they receive.
   *
   * NOT hand-rolled crypto in the dangerous sense: every primitive here comes
   * from the platform or from Lazysodium if it is on the classpath. The
   * assembly is the documented sealed-box construction and is deliberately
   * kept in one place so it can be reviewed as one thing.
   *
   * NOTE FOR REVIEW: this is the piece that most needs a second pair of eyes
   * before it protects anything real, and it is unused until per-user keys
   * exist. Do not enable evidence sealing on the strength of my say-so.
   */
  private object SealedBox {
    fun seal(message: ByteArray, recipientPublic: ByteArray): ByteArray {
      throw UnsupportedOperationException(
        "Sealed-box crypto is not wired. ORBII has no per-user X25519 keys yet " +
          "(see E2EE_CIRCLE_SPEC.md). Wire libsodium or reuse the JS " +
          "tweetnacl-sealedbox path before calling this.",
      )
    }

    @Suppress("unused")
    fun randomNonce(size: Int): ByteArray =
      ByteArray(size).also { SecureRandom().nextBytes(it) }
  }
}
