package com.orbii.app.mesh

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Native store-and-forward for mesh packets this phone caught but could not
 * bridge.
 *
 * WHY THIS EXISTS ON THE NATIVE SIDE AT ALL, when services/hotPotatoVault.ts
 * already does the same job in JS.
 *
 * OrbiiMeshService is a foreground service. Android will happily keep it running
 * while tearing down the React Native instance to reclaim memory, and it starts
 * on boot into a process where JS may never have run. In those states an emit to
 * the JS bridge goes nowhere. A relay that caught somebody's SOS and then had its
 * app killed would silently lose it, which is exactly the case the vault was
 * built for.
 *
 * So this is the holding pen: small, dumb, durable, written from the same worker
 * thread that failed the upload. JS drains it on next launch and does the actual
 * flushing, because the retry policy, the connectivity subscription and the
 * bridge URL all live there and should not be duplicated.
 *
 * IT NEVER LEARNS ANYTHING. The blob is the sealed ciphertext the mesh already
 * carries, base64'd. This file cannot read it and neither can the relay's owner.
 *
 * NOTHING HERE THROWS. It is called from the middle of the mesh daemon, and a
 * storage failure must cost us one packet, never the radio layer. Every entry
 * point catches and degrades: hold returns false, read returns empty.
 *
 * The three bounds are kept deliberately identical to the JS side in
 * services/hotPotatoVault.ts. If you change one, change both.
 */
object MeshVault {

  /** Matches VAULT_MAX_ENTRIES in services/hotPotatoVault.ts. */
  const val MAX_ENTRIES = 100

  /** Matches VAULT_TTL_MS. Six hours: an SOS is not a letter. */
  const val TTL_MS = 6L * 60L * 60L * 1000L

  private const val PREFS = "orbii_mesh_vault"
  private const val KEY = "entries_v1"

  /**
   * Guards read-modify-write.
   *
   * SharedPreferences is thread safe for individual gets and puts, but this does
   * read, mutate, write, and handleIncoming spawns a new Thread per packet. Two
   * beacons arriving together would otherwise interleave and one would overwrite
   * the other's entry.
   */
  private val lock = Any()

  data class Entry(val msgId: String, val sealed: String, val heldSince: Long)

  private fun prefs(ctx: Context) =
    ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun parse(raw: String?): MutableList<Entry> {
    val out = mutableListOf<Entry>()
    if (raw.isNullOrEmpty()) return out
    try {
      val arr = JSONArray(raw)
      for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i) ?: continue
        val msgId = o.optString("msgId", "")
        val sealed = o.optString("sealed", "")
        val heldSince = o.optLong("heldSince", 0L)
        // A malformed row is dropped rather than allowed to poison the list.
        // Losing one packet beats losing the queue.
        if (msgId.isEmpty() || sealed.isEmpty() || heldSince <= 0L) continue
        out.add(Entry(msgId, sealed, heldSince))
      }
    } catch (e: Exception) {
      // Corrupt store. Start clean; the alternative is a permanently broken
      // vault that fails on every future packet.
      return mutableListOf()
    }
    return out
  }

  private fun serialize(entries: List<Entry>): String {
    val arr = JSONArray()
    for (e in entries) {
      try {
        arr.put(
          JSONObject()
            .put("msgId", e.msgId)
            .put("sealed", e.sealed)
            .put("heldSince", e.heldSince),
        )
      } catch (ex: Exception) {
        // Skip the one that would not serialize.
      }
    }
    return arr.toString()
  }

  /** Drops expired entries, then trims to the cap keeping the NEWEST. */
  private fun prune(entries: MutableList<Entry>, now: Long): MutableList<Entry> {
    val live = entries.filter { now - it.heldSince in 0 until TTL_MS }.toMutableList()
    live.sortBy { it.heldSince }
    if (live.size > MAX_ENTRIES) {
      // A fresher emergency is the one still worth relaying, so the oldest go.
      return live.subList(live.size - MAX_ENTRIES, live.size).toMutableList()
    }
    return live
  }

  /**
   * Hold a sealed packet. Returns true if it was newly stored.
   *
   * Deduplicated on msgId: the mesh floods by design, so the same packet reaches
   * this phone several times over several hops and must occupy one slot.
   */
  fun hold(ctx: Context, msgId: String, sealedB64: String): Boolean {
    if (msgId.isEmpty() || sealedB64.isEmpty()) return false
    return try {
      synchronized(lock) {
        val p = prefs(ctx)
        val now = System.currentTimeMillis()
        val entries = prune(parse(p.getString(KEY, null)), now)
        if (entries.any { it.msgId == msgId }) return false

        entries.add(Entry(msgId, sealedB64, now))
        val next = prune(entries, now)
        // commit, not apply: this runs on a worker thread inside a service that
        // may be killed moments later, and the whole point is surviving that.
        p.edit().putString(KEY, serialize(next)).commit()
        true
      }
    } catch (e: Exception) {
      false
    }
  }

  /** Everything currently held, expired entries already removed. */
  fun read(ctx: Context): List<Entry> = try {
    synchronized(lock) {
      val p = prefs(ctx)
      val now = System.currentTimeMillis()
      val parsed = parse(p.getString(KEY, null))
      val entries = prune(parsed, now)

      // Only write when pruning actually removed something, and use apply()
      // rather than commit().
      //
      // read() is reached from the readVault and vaultSize @ReactMethods, which
      // run on the React Native module thread, and vaultStatusLine() calls it at
      // app start. commit() is synchronous disk I/O, so every status read blocked
      // the bridge on flash, and it wrote even when nothing had changed, which is
      // pointless wear on a cheap device.
      //
      // Durability matters for hold(), which is the write path and keeps
      // commit(). It does not matter for reclaiming space: if the process dies
      // before this lands, the next read prunes again.
      if (entries.size != parsed.size) {
        p.edit().putString(KEY, serialize(entries)).apply()
      }
      entries.toList()
    }
  } catch (e: Exception) {
    emptyList()
  }

  /**
   * Forget packets JS has taken responsibility for.
   *
   * Separate from read on purpose. If read cleared the store, a JS crash between
   * reading and persisting would destroy somebody's SOS. JS acknowledges only
   * after its own durable write, so the worst case is delivering twice, and the
   * bridge already deduplicates.
   */
  fun ack(ctx: Context, msgIds: Collection<String>): Int = try {
    synchronized(lock) {
      val p = prefs(ctx)
      val now = System.currentTimeMillis()
      val before = prune(parse(p.getString(KEY, null)), now)
      val drop = msgIds.toHashSet()
      val after = before.filterNot { drop.contains(it.msgId) }.toMutableList()
      p.edit().putString(KEY, serialize(after)).commit()
      before.size - after.size
    }
  } catch (e: Exception) {
    0
  }

  fun size(ctx: Context): Int = try {
    read(ctx).size
  } catch (e: Exception) {
    0
  }

  fun clear(ctx: Context) {
    try {
      synchronized(lock) { prefs(ctx).edit().remove(KEY).commit() }
    } catch (e: Exception) {
      // nothing to do
    }
  }
}
