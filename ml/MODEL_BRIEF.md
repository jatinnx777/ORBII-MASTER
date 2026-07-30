# ORBII — Voice SOS Keyword Model: Build Brief

**Read this whole file before writing any code.** You are being handed this cold,
with no access to the ORBII app repo or the conversation that produced this brief.
Everything you need to build the right thing is here. When something is
underspecified, ask the person who gave you this file — do not guess and build a
different kind of model.

---

## 1. What ORBII is

ORBII is a women's safety app for India (Android, launching on the Play Store).
Its headline feature is **Voice SOS**: the phone listens, fully on-device, and if
the user shouts a distress word like **"help"** or **"bachao"**, it starts an
emergency countdown and then alerts her circle / dispatches helpers.

Everything runs **offline, on the phone**. No audio ever leaves the device. This
is a hard privacy promise the app makes to users and to Google Play, and the
model you build must honour it.

## 2. Your one job

Build a **keyword-spotting model** (also called a **wake-word model** — same
category as "Hey Siri" / "Alexa"). It answers one question, many times per
second:

> "In the last ~1 second of audio, did the user shout one of our distress words?
> Yes or no, and how confident?"

That is the entire scope. Read section 9 ("What this is NOT") before you start,
because it's easy to accidentally build something ten times bigger and useless to
us.

## 3. Why we need it (context, not scope creep)

Today Voice SOS uses **Vosk** (an offline speech-to-text engine) plus **YAMNet**
(a sound classifier for screams/crying/glass) plus a lot of custom audio
filtering. Vosk transcribes *everything* into words and we scan the words for
"help"/"bachao". That works, but a general transcriber is heavy and gets confused
in noise and by repeated shouting ("help help").

A **dedicated keyword model** is smaller, faster, and far more accurate *for the
few words we actually care about*, because it only ever has to learn those words
instead of the whole language. That's the upgrade you're building.

## 4. The words to detect

Two "wake words", each with pronunciation variants, plus a background/negative
class:

| Class            | Meaning                | Notes                                    |
|------------------|------------------------|------------------------------------------|
| `help`           | English distress       | Include "help", possibly "help me"       |
| `bachao`         | Hindi distress (बचाओ)  | Include variants: "bachao", "bacho", "bachaao" |
| `madad` (optional) | Hindi "help" (मदद)   | Nice-to-have; "madad"/"madat"            |
| `negative`       | anything else / silence / normal speech / noise | The largest class by far |

Confirm the final word list with the founder before training — but design the
pipeline so **adding a word later is easy** (retrain, don't re-architect).

## 5. Exact model spec (this is the contract)

The app already runs TensorFlow Lite models on-device, so the output must match
what the app can load. Follow this precisely:

- **Input:** ~1 second of mono audio at **16 kHz**, as float samples in the
  range **[-1.0, 1.0]**. (The app feeds audio as 16-bit PCM and divides by
  32768.0 to get this range — mirror that in your preprocessing so training and
  inference match.)
- **Features:** log-mel spectrogram is the standard choice. If you use
  **openWakeWord**, it handles this for you.
- **Model type:** small **Convolutional Neural Network (CNN)** classifier (a
  spectrogram is an image; CNNs classify images). openWakeWord's approach — a
  shared pre-trained audio embedding + a small trained classifier head — is
  preferred because it needs far less data.
- **Output:** a probability per class (see section 4). The app fires when a real
  distress word crosses a confidence threshold. Give us a model where a sensible
  threshold (e.g. 0.7) cleanly separates real shouts from everyday speech.
- **Format:** **TensorFlow Lite (`.tflite`)**. This is mandatory — the app loads
  `.tflite` via `org.tensorflow.lite.Interpreter`. ONNX, PyTorch `.pt`, or a
  SavedModel we cannot ship. Convert to `.tflite` at the end.
- **Size:** ideally **under ~5 MB**. YAMNet, which we already ship, is ~4 MB.
  Smaller is better; it goes inside the app download.
- **Speed:** must run inference on a mid-range Android phone every ~0.75 s
  without draining battery. Keep it small; use `setNumThreads(2)`-friendly ops.

### How it plugs into the app (for your understanding)

The app has an existing detector, `ScreamDetector.kt`, that loads `yamnet.tflite`
from the app's `assets/` folder, keeps a rolling ~1 s window of 16 kHz float
audio, and runs the interpreter every ~0.75 s to get class scores. **Your model
will be loaded the exact same way.** So if your `.tflite`:

1. takes a 1 s (16000-sample) float window in [-1, 1], and
2. outputs a small score array (one score per class),

then integration is basically copy-paste of the existing YAMNet code. Keep your
input/output shapes simple and documented (write the shapes and class order in a
small `README` next to the model) so the app side knows exactly what index means
"help" vs "bachao".

## 6. Where to build it — the workflow

**Training does NOT run on a laptop or inside the app.** Three places:

1. **Train on Google Colab** (free GPU, runs in a browser). This is where the
   model is actually created.
2. **Keep the training code in a `ml/` folder** (this folder). Python scripts +
   a Colab notebook, version-controlled, separate from the app's
   React Native / Kotlin code. On Colab you `git clone` and run.
3. **The finished `.tflite` + its class-order README** get copied into the app's
   Android assets by the app developer. You deliver the model file; you do not
   touch the app code.

## 7. Recommended approach & tools (all free)

- **openWakeWord** (MIT license) — purpose-built for training custom wake words,
  exports to `.tflite`, and is designed to train mostly on **synthetic data**.
  Start here. Search "openWakeWord custom model".
- Fallback / from-scratch option: **TensorFlow / Keras** with the
  **Google Speech Commands** dataset approach (the canonical small-CNN
  keyword-spotting tutorial). Use this only if openWakeWord doesn't fit.
- **Google Colab** free tier for the GPU.
- Everything must stay **₹0 / free tier**. No paid APIs, no paid datasets, no
  cloud training bills. If a step seems to need money, stop and flag it.

## 8. The data problem (and why you don't need "lakhs of voices")

You will not find hundreds of thousands of real recordings of people shouting
"help" and "bachao", and you don't need to. The standard, legitimate approach:

- **Synthesize positives with TTS**: generate many spoken variants of each
  keyword using free text-to-speech across different voices, speeds, and pitches.
  openWakeWord is built around exactly this.
- **Augment with noise**: mix the keywords over free background-noise datasets
  (street, crowd, traffic, home) at different volumes so the model learns to hear
  the word *through* real-world noise. This is the single most important step for
  our use case, because emergencies are loud and messy.
- **Negatives**: pull lots of general speech and ambient sound (free public
  datasets) as the `negative` class, so the model learns that normal talking is
  NOT a trigger. The negative class should dwarf the positives.
- **Pitch/tempo/volume variation** matters especially because a distressed shout
  sounds different from a calm spoken word — bias augmentation toward loud,
  strained, fast delivery.

Document every dataset you use and its licence in the `ml/` README, so we can
prove the training data is legally clean for a shipping product.

## 9. What this is NOT (avoid these mistakes)

- ❌ **Not a speech-to-text / transcriber.** Do not build or fine-tune Whisper,
  Vosk, or any general ASR. We only need yes/no on a few words.
- ❌ **Not a cloud/API model.** It must run fully offline on the phone. No
  network calls at inference.
- ❌ **Not a large model.** If it's tens of MB or needs a big runtime, it's wrong.
- ❌ **Not PyTorch/ONNX as the final deliverable.** Final artifact is `.tflite`.
- ❌ **Do not collect real users' voices** or scrape audio of real people to
  train on. Synthetic + properly-licensed public datasets only.

## 10. What to deliver back

1. The trained **`.tflite` model file** (under ~5 MB).
2. A short **`README`** stating: input shape & format (16 kHz, 1 s, float
   [-1,1]), output shape, and **the exact class order** (which output index is
   `help`, which is `bachao`, etc.), plus the recommended firing threshold.
3. The **Colab notebook + scripts** in `ml/` that produced it (so it's
   reproducible and retrainable when we add words).
4. A short **accuracy note**: how it performs in quiet vs noisy conditions, and
   the false-positive rate on normal speech (this matters most — a safety app
   that cries wolf gets uninstalled).

## 11. Ground rules (non-negotiable, this is a safety product)

- **On-device and offline. Always.** Audio never leaves the phone.
- **₹0 budget.** Free tools and free/licence-clean data only.
- **Low false positives.** It is better to occasionally miss a word than to fire
  during normal conversation. When in doubt, tune toward fewer false alarms and
  let the app's countdown be the second safety net.
- **Reproducible.** Everything in `ml/`, documented, retrainable.

---

*If anything here is unclear or seems to require money, a real-user dataset, or a
model bigger than a few MB — stop and ask the founder before building. Building
the wrong kind of model is the main risk; this brief exists to prevent that.*
