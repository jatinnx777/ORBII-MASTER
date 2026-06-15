import 'package:shared_preferences/shared_preferences.dart';

/// Stores the user's custom safety phrases (mirrors RN `voice-phrases.ts`).
/// The native service always adds built-in panic words on top, so an empty
/// list is still protective.
class VoicePhrasesService {
  VoicePhrasesService._();

  static const _key = 'orbii.voice.phrases';

  static Future<List<String>> load() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getStringList(_key) ?? const ['help me orbii'];
  }

  static Future<void> save(List<String> phrases) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_key, phrases);
  }
}
