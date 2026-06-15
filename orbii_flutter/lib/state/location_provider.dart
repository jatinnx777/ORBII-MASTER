import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../services/location_service.dart';

/// Holds the user's current location + permission state. Replaces the slice of
/// RN's Redux `sosSlice` that Home reads (currentLocation, locationPermission).
class LocationState {
  const LocationState({this.location, this.granted = false, this.loading = true});

  final LatLng? location;
  final bool granted;
  final bool loading;

  LocationState copyWith({LatLng? location, bool? granted, bool? loading}) =>
      LocationState(
        location: location ?? this.location,
        granted: granted ?? this.granted,
        loading: loading ?? this.loading,
      );
}

class LocationNotifier extends StateNotifier<LocationState> {
  LocationNotifier() : super(const LocationState()) {
    bootstrap();
  }

  /// On Home mount: ensure permission, then fetch a fix. Mirrors RN
  /// `bootstrapPermission` + `loadLocationAndHelpers`.
  Future<void> bootstrap() async {
    final granted = await LocationService.isGranted();
    if (!granted) {
      final ok = await LocationService.requestPermission();
      state = state.copyWith(granted: ok, loading: false);
      if (!ok) return;
    } else {
      state = state.copyWith(granted: true);
    }
    await refresh();
  }

  Future<void> refresh() async {
    final loc = await LocationService.getCurrentLocation();
    state = state.copyWith(
      location: loc,
      granted: await LocationService.isGranted(),
      loading: false,
    );
  }
}

final locationProvider =
    StateNotifierProvider<LocationNotifier, LocationState>(
  (ref) => LocationNotifier(),
);
