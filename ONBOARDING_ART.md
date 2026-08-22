# ORBII onboarding art — generation prompts

Six images. Generate each in ChatGPT, save with the exact filename below, drop
them in `assets/onboarding/`, and tell me. I'll wire them in and delete the SVG
placeholders.

---

## Before you start, three things that decide whether this works

**1. Generate them in one chat, in order.** Image models hold style across a
conversation far better than across separate ones. Start a new chat, paste the
STYLE BLOCK, generate image 1, then say *"same style, same characters, next
scene:"* and paste scene 2. Six separate chats will give you six different-looking
illustrations and the flow will look assembled rather than designed.

**2. Size: 1024 × 1536 (portrait).** The app crops to roughly 3:4, so keep the
character in the middle 60% vertically with clear margin above and below. Anything
near the top or bottom edge may get cut.

**3. Flat vector, not realistic people.** You asked earlier about making them
realistic. I'd advise against it and I want to be straight about why: the whole
design — the lilac sky, the black speech bubbles, the flat colour blocks — is
built around illustration. Photoreal people dropped into it will look like stock
photos pasted onto a cartoon, and on a safety app that reads as cheap. If you do
want realism, say so and I'll redesign the layout around it properly rather than
bolting it on. These prompts assume the reference style you sent.

---

## STYLE BLOCK — paste this first, once

```
Flat vector illustration in a modern app-onboarding style. No outlines, no
strokes, no shading, no gradients on the characters, no texture. Bold saturated
flat colour blocks only.

BACKGROUND: soft lilac-to-pink vertical gradient (#F0DCF2 at the top to #E3BFE6
at the bottom). A simple city skyline silhouette in a slightly deeper purple
(#DCAEE2), semi-transparent, low on the frame — plain rectangular buildings, one
domed roof, one thin spire, a few small white windows. Small green leafy plants
in the bottom-left and bottom-right corners. Scattered white four-point sparkles
and a few small solid dots in orange (#F97A3D) and yellow (#FFD24A). Everything
soft and airy. No sun, no clouds with faces, no rainbows.

CHARACTERS: young adults, 20s, diverse skin tones, casual modern streetwear.
Simple friendly faces — two small dark dots for eyes and a small curved smile,
nothing else. No noses, no eyebrows, no detailed hair strands. Clothing in bold
saturated colour: mustard yellow, orange, cobalt blue, tomato red, emerald green,
with a lighter shirt visible under the jacket. Slightly stylised proportions with
a large head, which is what makes the style friendly. Full body, standing, feet
visible, centred in frame.

SPEECH BUBBLES: solid near-black (#17161C) rounded-rectangle bubbles with a small
pointed tail, containing short white bold lowercase text.

DO NOT INCLUDE: circular badges or icon circles floating around the character,
photorealism, 3D rendering, drop shadows, outlines, watermarks, UI mockups,
phone frames, text other than what is specified in the bubble, logos.
```

---

## The six scenes

### 1 — `voice.png`
**Screen says: "Just say the word"**

```
One young woman standing centred, facing forward, mustard-yellow jacket over a
white shirt, tomato-red trousers, dark hair in two buns, one hand raised beside
her head in a wave. Beside her at shoulder height, a small dark smartphone
floating upright with three curved sound-wave arcs coming out of its right side.
Above her to the left, a black speech bubble containing the white bold lowercase
word "help!".
```

### 2 — `handsfree.png`
**Screen says: "Works from your pocket"**

```
One young man standing centred, facing forward, cobalt-blue jacket over a pale
blue shirt, dark navy trousers, short dark hair, both arms relaxed at his sides.
A red shoulder bag hangs at his hip with its strap over his shoulder, and three
curved sound-wave arcs come out of the bag, showing the phone inside it is still
listening. Above him to the left, a black speech bubble containing the white bold
lowercase words "hands free".
```

### 3 — `offline.png`
**Screen says: "No signal? Still sent"**

```
One young woman standing centred, facing forward, orange jacket over a cream
shirt, deep indigo trousers, dark hair in a ponytail, one hand raised in a wave.
Three curved sound-wave arcs on her left side and three more mirrored on her
right side, radiating outward from her, showing a signal travelling out with no
tower and no wifi anywhere in the scene. Above her, a black speech bubble
containing the white bold lowercase words "no signal, still sent".
```

### 4 — `helpers.png`
**Screen says: "Someone actually comes"**

```
Two young people standing a short distance apart, both facing slightly toward
each other, both waving. On the left, a woman in a mustard-yellow jacket, white
shirt and tomato-red trousers with dark hair in two buns. On the right, a man in
an emerald-green jacket, pale shirt and navy trousers with short dark hair, mid
stride as though walking toward her. Two black speech bubbles: one above the left
figure reading "on my way", one above the right figure reading "I'm here", both
in white bold lowercase.
```

### 5 — `private.png`
**Screen says: "Your voice never leaves"**

```
One young woman standing centred, facing forward, soft purple jacket over a pale
lavender shirt, navy trousers, dark chin-length bob. She holds a small dark
smartphone close to her chest with both hands, screen toward the viewer. No sound
waves, no arrows, nothing leaving the phone — the stillness is the point. Above
her to the left, a black speech bubble containing the white bold lowercase words
"stays on your phone".
```

### 6 — `ready.png`
**Screen says: "Two things and you're set"**

```
Two young people standing side by side, centred, both facing forward, both
waving with one hand raised, both smiling. On the left, a woman in a
mustard-yellow jacket, white shirt and tomato-red trousers with dark hair in a
ponytail. On the right, a man in a cobalt-blue jacket, pale shirt and emerald-
green trousers with dark hair in a top knot. Two black speech bubbles: one above
the left figure reading "you're set", one above the right figure reading "let's
go", both in white bold lowercase.
```

---

## If the model drifts

It usually goes wrong in four predictable ways. Say the correction and regenerate
rather than starting over:

| What you get | Say this |
|---|---|
| Outlines around the characters | "remove all outlines and strokes, flat shapes only" |
| Detailed or realistic faces | "simplify the face to two dots and a small smile, nothing else" |
| Circles or badges floating around | "remove the floating circular icons entirely" |
| A different-looking person each time | "same character design and same style as the previous image" |

---

## Where to put them

```
D:\ORBII\assets\onboarding\
    voice.png
    handsfree.png
    offline.png
    helpers.png
    private.png
    ready.png
```

Exact filenames, lowercase, `.png`. Tell me when they're there and I'll swap the
SVG scenes for them — it's one line per screen, and everything else about the
layout stays exactly as it is now.

---

## What is NOT needed

**The auth screens need no artwork.** Look at the reference again: Log In,
Register, Forgot Password and Reset Password are all plain white forms with no
illustration at all. That is correct, and it is why they feel fast. Don't
generate anything for them.

**The splash needs no artwork** either — it is the wordmark on white, which is
already how the reference opens.
