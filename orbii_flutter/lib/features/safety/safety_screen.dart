import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/colors.dart';
import '../../core/widgets/orbii_dialog.dart';
import '../../services/voice_guard_service.dart';
import '../../services/voice_phrases_service.dart';
import '../../state/helpers_provider.dart';

/// Safety tools tab — helper availability, the custom voice-phrase list, and
/// background-reliability (battery) help. Closes the Phase 4 helper-toggle and
/// the Phase 3 phrase-editor carried items.
class SafetyScreen extends ConsumerStatefulWidget {
  const SafetyScreen({super.key});

  @override
  ConsumerState<SafetyScreen> createState() => _SafetyScreenState();
}

class _SafetyScreenState extends ConsumerState<SafetyScreen> {
  List<String> _phrases = const [];
  bool _loadingPhrases = true;

  @override
  void initState() {
    super.initState();
    _loadPhrases();
  }

  Future<void> _loadPhrases() async {
    final p = await VoicePhrasesService.load();
    if (!mounted) return;
    setState(() {
      _phrases = p;
      _loadingPhrases = false;
    });
  }

  Future<void> _addPhrase() async {
    final value = await showOrbiiPrompt(
      context,
      title: 'Add a safety phrase',
      subtitle: 'Say this to trigger an SOS hands-free.',
      hint: 'e.g. help me orbii',
      confirmLabel: 'Add',
      icon: Icons.record_voice_over,
    );
    if (value == null || value.length < 3) return;
    final next = [..._phrases, value];
    await VoicePhrasesService.save(next);
    setState(() => _phrases = next);
  }

  Future<void> _removePhrase(String phrase) async {
    final next = _phrases.where((p) => p != phrase).toList();
    await VoicePhrasesService.save(next);
    setState(() => _phrases = next);
  }

  @override
  Widget build(BuildContext context) {
    final helperOn = ref.watch(helperModeProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Safety')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // ── Helper availability ──
          Card(
            child: SwitchListTile(
              value: helperOn,
              activeThumbColor: AppColors.sage,
              onChanged: (v) =>
                  ref.read(helperModeProvider.notifier).setEnabled(v),
              title: Text('Available as a helper', style: AppTheme.semibold(15)),
              subtitle: Text(
                'Share your location so nearby people in danger can reach you.',
                style: AppTheme.medium(12),
              ),
            ),
          ),
          const SizedBox(height: 20),

          // ── Voice phrases ──
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Voice SOS phrases', style: AppTheme.semibold(15)),
              TextButton.icon(
                onPressed: _addPhrase,
                icon: const Icon(Icons.add, size: 18),
                label: const Text('Add'),
              ),
            ],
          ),
          Text(
            'Say any of these to trigger an SOS hands-free. Built-in panic '
            'words ("help", "bachao") always work too.',
            style: AppTheme.medium(12),
          ),
          const SizedBox(height: 8),
          if (_loadingPhrases)
            const Padding(
              padding: EdgeInsets.all(16),
              child: Center(child: CircularProgressIndicator()),
            )
          else
            ..._phrases.map((p) => Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: ListTile(
                    leading: const Icon(Icons.record_voice_over,
                        color: AppColors.lavenderDeep),
                    title: Text(p, style: AppTheme.medium(14, color: AppColors.textPrimary)),
                    trailing: IconButton(
                      icon: const Icon(Icons.close, size: 18),
                      onPressed: () => _removePhrase(p),
                    ),
                  ),
                )),
          const SizedBox(height: 20),

          // ── Background reliability ──
          Card(
            child: ListTile(
              leading: const Icon(Icons.battery_charging_full,
                  color: AppColors.peachDeep),
              title: Text('Keep ORBII running', style: AppTheme.semibold(15)),
              subtitle: Text(
                'Remove battery limits so background Voice SOS survives.',
                style: AppTheme.medium(12),
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: VoiceGuardService.requestBatteryExemption,
            ),
          ),
        ],
      ),
    );
  }
}
