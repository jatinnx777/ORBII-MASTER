import React, { useCallback, useEffect, useState } from 'react';
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Row,
  RowGroup,
  RowSection,
  ScreenContainer,
  useBrandSheet,
} from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import {
  alertVibrationToggled,
  onboardingReset,
  pushEnabledSet,
} from '@/redux/slices/appSlice';
import { getItem, setItem, storageKeys } from '@/services/storage';
import { signedOut } from '@/redux/slices/userSlice';
import { signOutFromGoogle } from '@/services/auth';
import { isVideoEvidenceReady, requestVideoEvidencePermissions } from '@/services/sos-video';
import { listCircles } from '@/services/circles';
import { circlesLoaded } from '@/redux/slices/circlesSlice';
import { loadEmergencyContacts } from '@/services/emergency-contacts';
import { profileUpdated } from '@/redux/slices/userSlice';
import { deleteMyData } from '@/services/consent';
import { isMeshRelayEnabled, setMeshRelayEnabled } from '@/services/mesh-consent';
import { startMeshListening, stopMeshListening } from '@/services/mesh';
import { clearPin } from '@/services/safety-pin';
import { useIsResponder } from '@/services/roles';
import { requestNotificationPermission } from '@/services/notifications';
import { APP_VERSION, COPYRIGHT_LINE } from '@/services/app-info';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

export function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);
  const alertVibration = useAppSelector((s) => s.app.alertVibration);
  const push = useAppSelector((s) => s.app.pushEnabled);
  const isResponder = useIsResponder();

  const sheet = useBrandSheet();
  const contactsCount = profile?.emergencyContacts?.length ?? 0;
  const circlesCount = useAppSelector((s) => s.circles.circles.length);

  // Settings shows counts (contacts, circles) that are edited on other screens.
  // Reading them straight from the store meant they only updated if some other
  // screen happened to have refetched, so the numbers here went stale and the
  // screen looked out of sync with the rest of the app. Refetch on focus.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      listCircles()
        .then((cs) => alive && dispatch(circlesLoaded(cs)))
        .catch(() => undefined);
      if (profile?.uid) {
        loadEmergencyContacts(profile.uid)
          .then((cs) => {
            if (alive && profile) dispatch(profileUpdated({ ...profile, emergencyContacts: cs }));
          })
          .catch(() => undefined);
      }
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dispatch, profile?.uid]),
  );

  // Offline mesh relay consent. DPDP Act 2023 §6(4): consent may be withdrawn
  // at any time and withdrawal must be as easy as giving it, so this is a
  // one-tap switch that takes effect immediately rather than on next launch.
  const [meshRelay, setMeshRelay] = useState(true);
  const [videoEvidence, setVideoEvidence] = useState(false);
  const [impactDetection, setImpactDetection] = useState(false);
  useEffect(() => {
    let alive = true;
    void isMeshRelayEnabled().then((v) => {
      if (alive) setMeshRelay(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Video evidence is permission-shaped, not a stored preference: the only
  // thing that decides whether it records is whether Android has granted the
  // camera. So the switch reflects the OS, and turning it OFF sends her to
  // system settings rather than flipping a flag we would then have to honour
  // in two places.
  // The switch must show what Android actually granted, including a permission
  // revoked from system settings while the app was closed. Read it on mount
  // rather than trusting anything we stored.
  useEffect(() => {
    let cancelled = false;
    void isVideoEvidenceReady().then((ok) => {
      if (!cancelled) setVideoEvidence(ok);
    });
    // Impact detection needs no permission, so unlike the camera above the
    // stored value IS the truth here.
    void getItem<boolean>(storageKeys.impactDetection).then((v) => {
      if (!cancelled) setImpactDetection(v === true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleImpactDetection = async (next: boolean) => {
    setImpactDetection(next);
    await setItem(storageKeys.impactDetection, next);
    if (next) {
      // Told once, on the way in, rather than buried in a settings row nobody
      // scrolls back to. The countdown IS the feature's safety margin: the
      // thresholds have not been measured on Indian handsets yet, so the
      // honest promise is not "it will not misfire", it is "when it does,
      // cancelling costs you five seconds".
      sheet.notify({
        title: 'Watching for a hard impact',
        body: 'If your phone takes a hard knock and then stops moving, you get a countdown. Cancel it and nobody is told. It only works while ORBII is open on screen.',
        tone: 'neutral',
      });
    }
  };

  const handleVideoEvidence = async (next: boolean) => {
    if (!next) {
      sheet.notify({
        title: 'Turn it off in Android settings',
        body: 'ORBII cannot take back a permission it was given. Open Settings, Permissions, Camera, and choose Deny. Your SOS keeps working either way.',
        tone: 'neutral',
      });
      void Linking.openSettings();
      return;
    }
    const granted = await requestVideoEvidencePermissions();
    setVideoEvidence(granted);
    sheet.notify({
      title: granted ? 'Video evidence on' : 'Not enabled',
      body: granted
        ? 'During an SOS, ORBII records video to your own gallery, in an album called ORBII. It is never uploaded to us and there is no way for us to see it.'
        : 'ORBII needs camera and gallery access to record. Nothing else changed, and your SOS works exactly as before.',
      tone: granted ? 'success' : 'neutral',
    });
  };

  const handleMeshRelay = async (next: boolean) => {
    setMeshRelay(next); // optimistic: the switch must feel instant
    await setMeshRelayEnabled(next);
    if (next) {
      await startMeshListening();
    } else {
      // Tear the service down now. A setting that only applies after a restart
      // is not a withdrawal of consent, it is a promise of one.
      await stopMeshListening();
    }
    sheet.notify({
      title: next ? 'Relay on' : 'Relay off',
      body: next
        ? 'Your phone can now carry a nearby emergency to the internet. It stays sealed, so you can never read what you carry.'
        : "Your phone will not carry anyone else's emergency. Your own SOS still works exactly as before.",
      tone: next ? 'success' : 'neutral',
    });
  };

  const handlePush = async (next: boolean) => {
    if (next) {
      const ok = await requestNotificationPermission();
      if (!ok) {
        sheet.notify({
          title: 'Permission denied',
          body: 'Enable notifications in system settings to receive alerts.',
          tone: 'warning',
        });
        return;
      }
    }
    dispatch(pushEnabledSet(next));
  };


  // Right to erasure (DPDP Section 12). Hard-deletes everything this user owns,
  // then signs them out.
  const handleDeleteData = () => {
    sheet.confirm({
      title: 'Delete your account & data?',
      body: 'This permanently erases your profile, circles, contacts, and all location history from ORBII. It cannot be undone.',
      destructive: true,
      confirmLabel: 'Delete everything',
      icon: 'trash',
      onConfirm: async () => {
        const ok = await deleteMyData();
        if (!ok) {
          sheet.notify({
            title: 'Could not delete',
            body: 'Something went wrong. Please try again, or email privacy@orbii.in and we will erase your data.',
            tone: 'warning',
          });
          return;
        }
        await signOutFromGoogle();
        await clearPin().catch(() => undefined);
        dispatch(signedOut());
      },
    });
  };

  const handleSignOut = () => {
    sheet.confirm({
      title: 'Sign out?',
      body: 'You can sign back in anytime. Your local profile and history will be cleared from this device.',
      destructive: true,
      confirmLabel: 'Sign out',
      icon: 'log-out',
      onConfirm: () => {
        // Sign out of the UI first, then tell the server. Awaiting the network
        // before dispatching meant a slow connection made this button look
        // broken, and the fix for a broken-looking button is never "tap harder".
        dispatch(signedOut());
        // Device-local PIN: clear it so the next user sets their own.
        void clearPin().catch(() => undefined);
        void signOutFromGoogle();
      },
    });
  };

  return (
    <ScreenContainer padded={false} scroll={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={10}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.title}>Settings</Text>
        </View>

        {/* Profile hero, a personal header, taps through to edit. */}
        <Pressable
          onPress={() => navigation.navigate('EditProfile')}
          style={({ pressed }) => [styles.profileHero, pressed && { opacity: 0.9 }]}
        >
          <View style={styles.profileAvatar}>
            {profile?.photoUri ? (
              <Image source={{ uri: profile.photoUri }} style={styles.profileAvatarImg} />
            ) : (
              <Text style={styles.profileInitial}>
                {(profile?.name || '?').charAt(0).toUpperCase()}
              </Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName} numberOfLines={1}>{profile?.name || 'Your name'}</Text>
            <Text style={styles.profileHandle} numberOfLines={1}>
              {profile?.username ? `@${profile.username}` : 'Tap to finish your profile'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>

        {/* Four full groups, not eight sparse ones. The screen previously had a
            box per idea, several holding a single row, which made it read as a
            long column of near-empty cards. Grouped by what you came here to
            do instead. */}
        <RowSection title="Safety" />
        <RowGroup>
          <Row
            icon="people-outline"
            label="Emergency contacts"
            value={`${contactsCount} ${contactsCount === 1 ? 'contact' : 'contacts'}`}
            onPress={() => navigation.navigate('EmergencyContacts')}
          />
          <Row
            icon="mic-outline"
            label="Voice SOS"
            value={'Shout "help, help" to trigger an SOS, hands-free'}
            onPress={() => navigation.navigate('VoicePhrases')}
          />
          <Row
            icon="people-circle-outline"
            label="Your circles"
            value={`${circlesCount} ${circlesCount === 1 ? 'circle' : 'circles'}`}
            onPress={() => navigation.navigate('Circles')}
          />
          <Row
            icon="hand-left-outline"
            label="Help people near you"
            value="Get alerted when someone close by fires an SOS. No signup, no verification."
            onPress={() => navigation.navigate('CommunityAlerts')}
          />
        </RowGroup>

        <RowSection title="Alerts" />
        <RowGroup>
          <Row
            icon="notifications-outline"
            label="Push notifications"
            value={
              push
                ? 'SOS, helpers, and circle activity'
                : "Off. You won't be notified"
            }
            right={
              <Switch
                value={push}
                onValueChange={handlePush}
                trackColor={{ true: colors.brand, false: colors.border }}
                thumbColor={colors.surface}
              />
            }
          />
          <Row
            icon="phone-portrait-outline"
            label="Vibrate on nearby alerts"
            value={
              alertVibration
                ? 'Buzz when help is needed within 2 km'
                : 'Off. No buzz on incoming alerts'
            }
            right={
              <Switch
                value={alertVibration}
                onValueChange={(v) => {
                  dispatch(alertVibrationToggled(v));
                }}
                trackColor={{ true: colors.brand, false: colors.border }}
                thumbColor={colors.surface}
              />
            }
          />
          <Row
            icon="mail-unread-outline"
            label="Notification inbox"
            value="Alerts, circle requests, and updates"
            onPress={() => navigation.navigate('Notifications')}
          />
        </RowGroup>

        {/* Emergency Network.
            Its own section because this is the only setting in the app that
            governs what ORBII does with SOMEONE ELSE'S data on this phone,
            rather than what it does with the user's own. Burying that in "App"
            would misrepresent what is being asked. */}
        <RowSection title="Crash and fall detection" />
        <RowGroup>
          <Row
            icon="pulse-outline"
            label="Detect a hard impact"
            value={
              impactDetection
                ? 'On. If your phone takes a hard knock and then stops moving, ORBII starts a countdown. Cancel it and nothing is sent. New feature, still being tuned, so tell us if it fires when it should not.'
                : 'Off. Turn this on and ORBII watches for a hard impact followed by stillness, then gives you a countdown to cancel before alerting your circle.'
            }
            right={
              <Switch
                value={impactDetection}
                onValueChange={(v) => void handleImpactDetection(v)}
                trackColor={{ true: colors.brand, false: colors.border }}
                thumbColor={colors.surface}
              />
            }
          />
          {impactDetection ? (
            // Said plainly, because someone who reads "crash detection" and
            // thinks of Life360 will assume it covers them while driving with
            // the phone in a pocket, and it does not. ORBII watches the
            // accelerometer only while the app is open on screen. Letting that
            // misunderstanding stand on a safety app is worse than not having
            // the feature.
            <Row
              icon="information-circle-outline"
              label="What this cannot do yet"
              value="It only watches while ORBII is open on your screen. It will not detect a crash with your phone in a pocket or bag, and it is not a substitute for calling 112."
            />
          ) : null}
        </RowGroup>

        <RowSection title="Evidence" />
        <RowGroup>
          <Row
            icon="videocam-outline"
            label="Record video during an SOS"
            value={
              videoEvidence
                ? 'On. Saved to your own gallery in an ORBII album, in one minute clips. Never uploaded, and we can never see it.'
                : 'Off. Turn this on and ORBII records video during an SOS, straight to your gallery and nowhere else.'
            }
            right={
              <Switch
                value={videoEvidence}
                onValueChange={(v) => void handleVideoEvidence(v)}
                trackColor={{ true: colors.brand, false: colors.border }}
                thumbColor={colors.surface}
              />
            }
          />
        </RowGroup>

        <RowSection title="Emergency Network" />
        <RowGroup>
          <Row
            icon="git-network-outline"
            label="Offline mesh relay"
            value={
              meshRelay
                ? 'On. Your phone can carry a nearby SOS to the internet when theirs has no signal. You cannot read what you carry.'
                : "Off. Your phone will not carry anyone else's emergency. Your own SOS is unaffected."
            }
            right={
              <Switch
                value={meshRelay}
                onValueChange={(v) => void handleMeshRelay(v)}
                trackColor={{ true: colors.brand, false: colors.border }}
                thumbColor={colors.surface}
              />
            }
          />
        </RowGroup>

        <RowSection title="App" />
        <RowGroup>
          <Row
            icon="language-outline"
            label="Language"
            value="English, Hindi, Punjabi, Tamil, Bengali"
            onPress={() => navigation.navigate('LanguageSelectorApp')}
          />
          <Row
            icon="location-outline"
            label="Location permissions"
            value="Opt-in, you pick how long, deleted after 7 days"
            onPress={() => Linking.openSettings().catch(() => undefined)}
          />
          <Row
            icon="information-circle-outline"
            label="About ORBII"
            value="What we do, who we are"
            onPress={() => navigation.navigate('About')}
          />
        </RowGroup>

        <RowSection title="Your data" />
        <RowGroup>
          <Row
            icon="document-text-outline"
            label="Privacy Policy"
            value="What we collect, why, and your rights under the DPDP Act"
            onPress={() =>
              Linking.openURL('https://www.orbii.in/privacy-policy').catch(() => undefined)
            }
          />
          <Row
            icon="shield-half-outline"
            label="Grievance Officer"
            value="Questions or complaints about your data? privacy@orbii.in"
            onPress={() =>
              Linking.openURL(
                'mailto:privacy@orbii.in?subject=ORBII%20data%20request',
              ).catch(() => undefined)
            }
          />
          <Row
            icon="trash-outline"
            label="Delete my account & data"
            value="Permanently erase everything ORBII holds about you"
            destructive
            onPress={handleDeleteData}
          />
        </RowGroup>

        <RowSection title="Account" />
        <RowGroup>
          {/* Run the setup again.
              Everything it touches is idempotent: signing in with the same
              email returns the same account, and the contact, PIN and circle
              steps overwrite rather than duplicate. So this is safe for anyone,
              and it is the only way to see the flow again without creating a
              throwaway account, which is a miserable way to check your own
              onboarding. */}
          <Row
            icon="refresh"
            label="Run setup again"
            onPress={() => {
              sheet.confirm({
                title: 'Run setup again?',
                body: 'You will be signed out and taken back through setup. Sign in with the same email and nothing is lost: your contacts, circle and history all come back.',
                confirmLabel: 'Run it again',
                onConfirm: async () => {
                  await setItem(storageKeys.onboarded, false);
                  dispatch(onboardingReset());
                  dispatch(signedOut());
                  void signOutFromGoogle();
                },
              });
            }}
          />
          <Row
            icon="log-out"
            label="Sign out"
            destructive
            onPress={handleSignOut}
            last
          />
        </RowGroup>

        <View style={styles.footer}>
          <Text style={styles.versionText}>Version {APP_VERSION}</Text>
          <Text style={styles.copyrightText}>{COPYRIGHT_LINE}</Text>
          <Text style={styles.copyrightText}>
            Data Protection / Grievance Officer · privacy@orbii.in
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: 120,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.icon,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 34,
    lineHeight: 40,
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  profileHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    ...shadows.card,
  },
  profileAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  profileAvatarImg: { width: '100%', height: '100%' },
  profileInitial: { fontFamily: fontFamilies.poppinsBold, fontSize: 22, color: colors.brandDeep },
  profileName: { fontFamily: fontFamilies.poppinsBold, fontSize: 17, color: colors.textPrimary },
  profileHandle: { fontFamily: fontFamilies.interMedium, fontSize: 13, color: colors.textSecondary, marginTop: 1 },
  soonPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.goldSoft,
  },
  soonText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 10,
    color: colors.goldDeep,
    letterSpacing: 0.4,
  },
  rowsCard: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: 0,
    overflow: 'hidden',
    ...shadows.card,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 56,
  },
  upgradeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
    borderWidth: 1,
    borderColor: colors.brandMid,
  },
  bannerPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  upgradeBannerText: {
    flex: 1,
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12,
    color: colors.brandDeep,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    gap: 4,
  },
  versionText: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 12,
    color: colors.textMuted,
  },
  copyrightText: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 0.2,
  },
});
