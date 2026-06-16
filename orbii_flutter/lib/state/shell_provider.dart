import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Currently-selected bottom-nav tab (0 Home · 1 Safety · 2 Plans · 3 Profile).
/// Lets any screen jump tabs — e.g. the Home header's profile icon → Profile.
final shellTabProvider = StateProvider<int>((ref) => 0);
