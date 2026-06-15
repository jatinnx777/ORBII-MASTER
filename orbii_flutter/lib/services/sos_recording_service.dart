import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

/// Captures a short audio clip when an SOS fires (RN `sos-recording.ts`). The
/// file is uploaded to the private `sos-recordings` bucket by [SosService].
class SosRecordingService {
  final _recorder = AudioRecorder();
  String? _path;

  /// Begin recording to a temp `.m4a`. Best-effort — returns false if the mic
  /// is unavailable so the SOS itself is never blocked.
  Future<bool> start(String sosId) async {
    try {
      if (!await _recorder.hasPermission()) return false;
      final dir = await getTemporaryDirectory();
      _path = '${dir.path}/$sosId.m4a';
      await _recorder.start(
        const RecordConfig(encoder: AudioEncoder.aacLc),
        path: _path!,
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Stop and return the file path (or null if nothing was captured).
  Future<String?> stop() async {
    try {
      final path = await _recorder.stop();
      return path ?? _path;
    } catch (_) {
      return _path;
    }
  }

  Future<void> dispose() async {
    try {
      if (await _recorder.isRecording()) await _recorder.stop();
    } catch (_) {/* ignore */}
    await _recorder.dispose();
  }
}
