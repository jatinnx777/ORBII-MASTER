import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'services/supabase_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Load the publishable Razorpay key id (.env). Non-fatal if absent — the
  // create-order Edge Function also returns the key id.
  try {
    await dotenv.load(fileName: '.env');
  } catch (_) {/* optional */}
  await SupabaseService.init();
  runApp(const ProviderScope(child: OrbiiApp()));
}
