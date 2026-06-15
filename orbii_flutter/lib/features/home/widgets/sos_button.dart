import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/theme/colors.dart';

/// Primary SOS trigger — coral block. Tap → countdown; long-press → instant
/// SOS (mirrors RN `SOSButton` onPress / onLongPress).
class SosButton extends StatefulWidget {
  const SosButton({super.key, required this.onPress, required this.onLongPress});

  final VoidCallback onPress;
  final VoidCallback onLongPress;

  @override
  State<SosButton> createState() => _SosButtonState();
}

class _SosButtonState extends State<SosButton> {
  double _scale = 1;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: GestureDetector(
        onTapDown: (_) => setState(() => _scale = 0.97),
        onTapUp: (_) => setState(() => _scale = 1),
        onTapCancel: () => setState(() => _scale = 1),
        onTap: widget.onPress,
        onLongPress: widget.onLongPress,
        child: AnimatedScale(
          scale: _scale,
          duration: const Duration(milliseconds: 90),
          child: Container(
            height: 156,
            decoration: BoxDecoration(
              color: AppColors.coral,
              borderRadius: BorderRadius.circular(24),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x40FF6B57),
                  blurRadius: 24,
                  offset: Offset(0, 10),
                ),
              ],
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.sos_rounded,
                    size: 44, color: AppColors.textInverse),
                const SizedBox(height: 6),
                Text('SOS',
                    style: AppTheme.bold(22, color: AppColors.textInverse)),
                Text('Hold for instant',
                    style: AppTheme.medium(11, color: const Color(0xCCFFFFFF))),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
