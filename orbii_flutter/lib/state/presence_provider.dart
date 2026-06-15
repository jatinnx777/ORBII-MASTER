import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/presence_service.dart';

/// Live presence peers (helpers/circle members sharing location). Seeded with
/// the last known state so the first frame isn't empty.
final presencePeersProvider = StreamProvider<List<PresencePeer>>((ref) {
  return PresenceService.stream;
});

/// Count of presence peers near a point (excluding self). Computed from the
/// last presence snapshot — cheap, no network. The radius mirrors the Home map.
int presenceNearbyCount({
  required String? selfUid,
}) {
  // Distance filtering happens in Home (it has the live location); here we
  // expose the raw peer list size minus self for the empty-location case.
  final peers = PresenceService.current;
  return peers.where((p) => p.userId != selfUid).length;
}
