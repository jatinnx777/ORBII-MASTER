# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# ── ORBII: defensive keeps so R8 (release minify) never strips a class a
# native module loads by reflection. A missing class on a safety app means
# a crash on the SOS path, so we keep generously here.
-keep class expo.modules.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class org.maplibre.** { *; }
-keep class com.maplibre.** { *; }
-dontwarn org.maplibre.**
-dontwarn com.maplibre.**

# Vosk + JNA (background Voice SOS). JNA references desktop-only java.awt
# classes that don't exist on Android — tell R8 to ignore them, and keep the
# Vosk/JNA classes (loaded via JNI/reflection).
-keep class org.vosk.** { *; }
-keep class com.sun.jna.** { *; }
-dontwarn com.sun.jna.**
-dontwarn java.awt.**

# LiteRT (TensorFlow Lite successor) — YAMNet distress-sound detection. Keeps the
# org.tensorflow.lite API and the LiteRT native/JNI-loaded classes.
-keep class org.tensorflow.lite.** { *; }
-keep class com.google.ai.edge.litert.** { *; }
-dontwarn org.tensorflow.lite.**
-dontwarn com.google.ai.edge.litert.**

# Razorpay (react-native-razorpay) — keep SDK + payment callbacks; silence
# optional deps it references but we don't ship.
-keep class com.razorpay.** { *; }
-keep class proguard.annotation.** { *; }
-keepclasseswithmembers class * { public void onPayment*(...); }
-dontwarn com.razorpay.**
-dontwarn proguard.annotation.**
-optimizations !method/inlining/*

# Add any project specific keep options here:
