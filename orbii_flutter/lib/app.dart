import 'dart:async';
import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/theme/app_theme.dart';
import 'router/app_router.dart';

/// Root widget — `MaterialApp.router` wired to the auth-gated GoRouter, plus a
/// deep-link listener that turns `orbii://voice-sos` (fired by the native Voice
/// SOS service) into an instant SOS.
class OrbiiApp extends ConsumerStatefulWidget {
  const OrbiiApp({super.key});

  @override
  ConsumerState<OrbiiApp> createState() => _OrbiiAppState();
}

class _OrbiiAppState extends ConsumerState<OrbiiApp> {
  final _appLinks = AppLinks();
  StreamSubscription<Uri>? _sub;

  @override
  void initState() {
    super.initState();
    _initDeepLinks();
  }

  Future<void> _initDeepLinks() async {
    final initial = await _appLinks.getInitialLink();
    if (initial != null) _handle(initial);
    _sub = _appLinks.uriLinkStream.listen(_handle);
  }

  void _handle(Uri uri) {
    if (uri.scheme == 'orbii' && uri.host == 'voice-sos') {
      ref.read(routerProvider).go('${Routes.sosCountdown}?instant=true');
    }
    // Supabase OAuth redirects (com.orbii.app://login-callback) are consumed by
    // supabase_flutter's own listener; no action needed here.
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'ORBII',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      routerConfig: router,
    );
  }
}
