# Master Instruction for Claude
You are a Principal UI/UX React Native / Tailwind Engineer. 
Below are detailed polish prompts for the ORBII Safety App screens. 
Review each section carefully, prioritize high-trust visual polish (gradients, spacing, shadows), and update the relevant components while maintaining clean, maintainable TypeScript code.

# Claude UI/UX Polish Prompt: Screen 1 (Home Dashboard)

**Context:** Connected to ORBII Safety UI project. Focusing on elevating the Home screen to a premium feel. Reference `image_0.png`.

**Instructions:** Please apply the following UI improvements to the Home Dashboard (`Home.tsx` / `Dashboard.tsx`):

### 1. Header & Map Layout
*   Reduce the `Trip`/`Friends` pill container height slightly.
*   Add increased vertical spacing (padding-top) between the top pill navigation and the 'Share Location' banner to reduce crowding.

### 2. Premium Safety Status Card
*   Modify the 'Your Safety Status' component.
*   Instead of a solid purple progress bar, implement a progress bar with a subtle horizontal gradient (e.g., `<color-brand-primary>` to `<color-brand-light>`).
*   Add a subtle `drop-shadow` to the entire status card (`box-shadow: 0 4px 10px rgba(0,0,0,0.05);`) to elevate it visually.

### 3. Sleek Member/Friends List
*   **Refactor the Member card:** Combine the current Member details row (image, text, presence dot) and the action buttons (`Circle`, `Call`, `Navigate`) into a single, cohesive row item.
*   **New Design:** On the left, the Avatar. Center: Name/Status (Offline). On the right, place small, stylized, light-gray versions of the Call and Navigate icons.
*   **Actions:** Make the *entire row* tappable to open the Circle details/actions, removing the bulky separate purple button container below it.
*   **Typography:** Set the `Friends` section header text to a slightly heavier weight.

### 4. Elevated Nearby Safe Places
*   Modify the `Nearby Safe Places` section header: Set to uppercase, gray, with increased letter-spacing (`Nearby Safe Places`) and set `Nearby Safe Places` itself to a slightly lighter font weight.
*   Refine the service icons (Police, Hospital, Cafe, Metro): Remove the harsh gray borders. Instead, add a soft `background-color` (e.g., `#F6F7FB`) or a subtle `shadow` to each box. Increase spacing between these icons.

### 5. Card Elevations (General)
*   Ensure all primary list cards ('1 Person...', 'Activate Voice SOS', 'No Active Alerts') have a consistent, subtle `shadow` to give the UI depth against the background.
# Claude UI/UX Polish Prompt: Screen 2 (Community)

**Context:** Connected to ORBII Safety UI project. Focusing on screen elevation and community flow. Reference `image_1.png`.

**Instructions:** Please apply the following UI improvements to the Community screen (`Community.tsx` / `Feed.tsx`):

### 1. Organic Anonymity Banner
*   Refactor the 'Be respectful. Stay safe...' banner.
*   Instead of the border box, set the entire banner text area to a subtle light background (e.g., `#FDF2F9` - light lavender-rose) and make the border-radius organic (slightly less pill-shaped, softer). Ensure the purple heart remains distinct.

### 2. Community Header
*   Reduce vertical padding slightly between the top 'Community' title and the primary tabs (`Explore`, `Following`, `My Posts`).

### 3. Post Card Spacing & Typography
*   **Content Padding:** Add increased vertical padding inside the entire post card to give elements breathing room.
*   **Post Content:** Increase the line height (`line-height: 1.5;`) for the post text (`Hihii`). Add a very small margin-top to separate the author details (`Jatin Kumar...`) from the post body.
*   **Typography:** The author's name (`Jatin Kumar`) should be slightly bolder than the `@username`.

### 4. Interaction Interaction Area
*   Modify the `Heart` and `Comment` interaction area: Wrap the icons/counts in a container and add a subtle `0.5s` `hover`/`press` effect (e.g., change background to a very pale gray `#F4F5F7` or add a soft border) to clarify the tappable area.

### 5. Floating Action Button (FAB)
*   Slightly reduce the size of the floating edit (pencil) button. Move its vertical position up by 8-12px so it sits better against the navigation bar area.
# Claude UI/UX Polish Prompt: Screen 3 (Emergency Menu)

**Context:** Connected to ORBII Safety UI project. This is a critical screen requiring high-trust and immediate clarity. Reference `image_2.png`.

**Instructions:** Please apply the following UI improvements to the Emergency screen (`Emergency.tsx` / `EmergencyHub.tsx`):

### 1. Premium 'Voice SOS' Feature
*   Refactor the primary 'Activate Voice SOS' component.
*   Instead of a static purple block, create a complex background gradient: A soft, animated pulse gradient transitioning from `<color-brand-primary>` (purple) through a hint of `<color-brand-accent>` (orange/yellow) to convey 'AI/Magic/Active.'
*   Add a very subtle animated border glow around the card.
*   Place a small 'AI' or 'Smart' stylized icon badge near the main microphone icon.

### 2. Section Spacing & Hierarchy
*   Add significant vertical spacing *above* 'MORE TRIGGERS' and 'SAFETY MODES' section headers to make the layout breathe and improve readability.
*   Set all section headers (`MORE TRIGGERS`, `YOUR CIRCLE`, etc.) to uppercase, slightly increased letter-spacing, and a slightly lighter gray weight.

### 3. Emergency Recording Cards
*   Reduce the height of the `Emergency Recording` (Audio, Video, Photo) grid container.
*   Add soft, internal box-shadows to the individual recording option cards (`Audio record`, `Video record`, `Photo capture`) to lift them slightly.
*   Remove the boxed 'Soon' labels and replace them with a subtle, consistent status bar or text effect (e.g., `<text-color-light-gray> (coming soon)`) below the title.

### 4. Card Interaction
*   Ensure all list items ('Trusted circle', 'Safe journey', etc.) have a consistent, subtle hover/press effect that visually lifts the card.
# Claude UI/UX Polish Prompt: Screen 4 (Disaster Mode)

**Context:** Connected to ORBII Safety UI project. Focusing on empowering flow, reducing immediate panic while maintaining urgency. Reference `image_3.png`.

**Instructions:** Please apply the following UI improvements to the Disaster Mode screen (`DisasterMode.tsx`):

### 1. Header & Trust
*   Modify the primary top icon (exclamation mark): Shift its background from danger-red to a strong, high-visibility Emergency Orange (`#FF5722`) or a high-contrast high-trust Deep Purple.
*   Add increased padding inside the main pink header text box.

### 2. High-Trust Urgent Action Button
*   Refactor the primary action button: 'I need help'.
*   Shift its background color from pure red to a high-saturation, trusted emergency orange (`#FF6E40`) to reduce direct anxiety while keeping visibility high.
*   Set the white text and icon to bold/heavy weight. Add a noticeable `drop-shadow` for immediate actionability.

### 3. Helpline Grid Hierarchy
*   Modify the helpline cards (`112 Emergency`, `108 Ambulance`):
    *   Set the helpline number (`112`, `108`) to bold weight and slightly larger font size.
    *   Increase line height for the helpline label (`Emergency`, `Ambulance`) to improve clarity. Add small padding above the label.

### 4. Dropdown Menu Polish
*   Refactor the 'IF IT’S A...' section and the dropdowns (`Flood`, `Earthquake`, etc.).
*   Give each dropdown select button a soft gray background fill (e.g., `#F4F5F7`) and consistent padding to look like tappable form elements, rather than just bordered buttons.

### 5. Interaction
*   Ensure the 'I need help' button has a powerful pulse animation on press to confirm the emergency action.
# Claude UI/UX Polish Prompt: Screen 5 (Profile)

**Context:** Connected to ORBII Safety UI project. Focusing on organization and distinguishing user roles (Responder). Reference `image_4.png`.

**Instructions:** Please apply the following UI improvements to the Profile screen (`Profile.tsx`):

### 1. Grouped List Organization
*   Refactor the flat list of cards into distinct, named groups.
*   Add section headers (e.g., `ACTIONS`, `ACCOUNT`, `RESPONDER`, `SETTINGS`) before each grouped set of cards. Use uppercase, slightly lighter gray font, and increased letter spacing for headers.

### 2. Action Grid Elevation
*   Modify the action cards (`SOS history`, `Trusted circle`, `Evidence vault`, etc.):
    *   Replace the simple gray circle background with a subtle, consistent background shape (e.g., a very soft rounded square or hexagon) in a pale lavender background (`#FDF0FF`).
    *   Slightly reduce vertical padding between these cards.

### 3. Distinct Responder Section
*   Create a distinct visual block for `RESPONDER` tools.
*   Add a subtle boundary (border or very pale background color) around the group: `Responder Missions`, `Recognition & Guardian level`, `Earnings & Payouts`, `ORBII coins`.
*   Give `Responder Approvals` (the Admin task) a specific visual identifier or icon color.

### 4. Premium Upgrade Card
*   Add a subtle gradient texture and a soft glow effect to the `Responder Missions` yellow upgrade card.

### 5. Log Out / Account Actions
*   Increase vertical spacing between the last settings item and the 'Log Out' button. Reduce the size of 'Delete my account' and slightly decrease its text weight.
# Claude UI/UX Polish Prompt: Screen 6 (Earnings)

**Context:** Connected to ORBII Safety UI project. Elevating the wallet/finances UI for a high-trust feel. Reference `image_5.png`.

**Instructions:** Please apply the following UI improvements to the Earnings screen (`Earnings.tsx`):

### 1. Premium Wallet Balance
*   Modify the 'WALLET BALANCE' component.
*   Shift the background from flat green-white to a soft, premium gradient (e.g., pale jade `#E2FFF4` to pure white).
*   Add a subtle animated sparkle effect when the balance is displayed or updated.

### 2. Balance Typography
*   Set the `WALLET BALANCE` header to uppercase with slightly increased letter spacing.
*   Set the main balance amount (`₹0`) to a heavy font weight and slightly increase its font size. Set the amount text color to a very dark green.

### 3. Earnings Spacing
*   Add increased vertical spacing between the main wallet card and the two summary cards (`0 People helped`, `₹0 Earned in total`).
*   Ensure the summary card numbers have balanced vertical padding.

### 4. Elevated Blank State (Payout History)
*   Refactor the blank state for 'PAYOUT HISTORY'.
*   Instead of just the list icon, integrate a sleek placeholder illustration (e.g., an animated coin or a stack of receipts) that feels customized for the app.
*   Update the 'No payouts yet' text to a lighter gray weight.

### 5. Disclosures Spacing
*   Add significant padding *above* the final 'Payouts are reviewed...' informational text to improve visual separation.
# Claude UI/UX Polish Prompt: Screen 7 (Missions)

**Context:** Connected to ORBII Safety UI project. Elevating the Responder workflow. Reference `image_6.png`.

**Instructions:** Please apply the following UI improvements to the Missions screen (`Missions.tsx`):

### 1. Streamlined Offline Card
*   Refactor the top 'You're offline' component.
*   Combine the text message and the large toggle switch into a single, cleaner list item design: Right-aligned toggle, left-aligned text and shield icon.

### 2. Balanced Guardian Metrics
*   Modify the `Guardian level` (Bronze) and `Trust score` (50) cards.
*   Instead of a simple gray background, place them inside a single container with significant vertical padding.
*   Make the 'Bronze' text slightly bolder than the label.

### 3. Premium Summary Glow (Badges)
*   Modify the `Badges & Recognition` yellow card.
*   Integrate a soft, pulsing golden gradient glow around the entire card (like the AI summary effect) to denote premium status and automated tracking.

### 4. Impact Counts
*   Ensure the impact counts (`People assisted`, `This month`) have balanced vertical and horizontal padding, and the numbers have heavy font weights.

### 5. Final Disclosure
*   Increase padding *above* the final 'Always reach safely...' disclosure text.
# Claude UI/UX Polish Prompt: Screen 8 (Recognition Levels)

**Context:** Connected to ORBII Safety UI project. Elevating the progression system. Reference `image_7.png`.

**Instructions:** Please apply the following UI improvements to the Recognition Levels screen (`Levels.tsx`):

### 1. Balanced List Hierarchy
*   Modify all progress cards (`Bronze`, `Silver`, `Gold`, `Elite`).
*   Reduce vertical padding within each card.
*   Set the core Level Title (`Silver`, `Gold`) to a heavier font weight and dark purple.
*   Change the subtext colors: The requirements (`10+ people assisted...`) should be a dark gray, and the benefits (`Priority dispatch...`) should remain a high-trust green.

### 2. Premium Active Level Highlight
*   Refactor the active level highlight ('Bronze').
*   Instead of just the light border, apply a complex, elegant background treatment. Apply a subtle golden gradient to the *entire background of the card*, and add a sophisticated outer shadow that looks like a subtle pulse.

### 3. Progressive Iconography
*   Ensure the progressive nature of the icons (Bronze > Silver > Gold > Elite) is reflected not just in color but perhaps in complexity or a subtle shape difference in the background container.

### 4. Spacing
*   Increase the vertical spacing *between* the list of levels and the final informational disclosure text. Set the disclosure text weight to lighter gray.
# Claude UI/UX Polish Prompt: Screen 9 (Coins & Redemption)

**Context:** Connected to ORBII Safety UI project. Elevating the coins/gamification UI. Reference `image_8.png`.

**Instructions:** Please apply the following UI improvements to the Coins screen (`Coins.tsx`):

### 1. Dynamic Redemption Goal
*   Refactor the 'Redeem at 500 coins' progress section.
*   Shift the basic progress bar to a progress bar with a soft gradient (e.g., golden orange to pale lavender).
*   Add a subtle, pulsing animated shape/glow around the target redemption amount (`₹50`).

### 2. Redemption Button Spacing
*   Add increased vertical spacing between the progress bar and the 'Redeem for cash' button to reduce crowding.

### 3. Elevated Empty State (Activity)
*   Refactor the empty 'ACTIVITY' list state.
*   Instead of just text, integrate a customized empty state placeholder: a sleek illustration of an empty digital ledger or a stylized, ghosted stack of coins, accompanied by customized placeholder typography.

### 4. Spacing
*   Increase vertical spacing *above* the 'ACTIVITY' header and above the final disclosure text.
# Claude UI/UX Polish Prompt: Screen 10 (Geofencing Step 1 - Choose Circle)

**Context:** Connected to ORBII Safety UI project. Elevating the Geofencing creation flow. Reference `image_0.png`.

**Instructions:** Please apply the following UI improvements to the Geofencing Step 1 view (`GeofenceStep1.tsx`):

### 1. Stepper Visual Polish
* Refactor the progress step indicator (Circle -> Member -> Area):
  * For active step `1 (Circle)`, give the step circle a filled brand background (`<color-brand-primary>`) with white bold text, and a subtle drop shadow (`box-shadow: 0 2px 6px rgba(124, 93, 250, 0.3)`).
  * Set the step label `Circle` to dark bold text.
  * Inactive steps (2, 3) should remain soft gray with secondary label text.

### 2. Selection Card Styling
* Refactor the options list (`Trip`, `Friends`, `Family`):
  * Replace simple bottom border lines with individual card blocks.
  * Give each option row a soft background fill (e.g., `#F8F9FE`), `border-radius: 12px`, and internal padding (`padding: 16px`).
  * Replace default icon background with a vibrant, semi-transparent brand-colored circle container (`#F0EBFF`).
  * Increase horizontal space between icon, title, and right chevron arrow.

### 3. Header & Sheet Layout
* Increase top padding above the 'Choose a circle' heading.
* Make 'Pick the group this safe zone belongs to.' subtext slightly lighter gray (`#6B7280`).
# Claude UI/UX Polish Prompt: Screen 11 (Geofencing Step 3)

**Context:** Connected to ORBII Safety UI project. Elevating the map polygon and time schedule controls. Reference `image_1.png`.

**Instructions:** Please apply the following UI improvements to the Geofencing Area screen (`GeofenceStep3.tsx`):

### 1. Map Polygon & Marker Styling
* **Map Overlay:** Set the polygon fill on the map to a semi-transparent brand purple (`rgba(124, 93, 250, 0.25)`) with a clean outer border stroke (`#7C5DFA`, `2px`). Ensure polygon points sort clockwise/counter-clockwise to prevent self-intersecting lines.
* **Map Pins:** Modernize point markers (1, 2, 3, 4) with pulsing outer rings and white center text.

### 2. Status Badge & Input Fields
* **Corner Counter Badge:** Fix text string. Change `4/3+ corners` to `4 Points Set` or `4 Corners (Min 3)` in a pill container with high-contrast text.
* **Name Input:** Make the 'Name the area (College, Home...)' input field border well-defined with a soft white card background (`#FFFFFF`) and a subtle gray border stroke (`#E5E7EB`).

### 3. Time Picker Elevation
* **Wheel Affordance:** In the 'Hours they should be inside' section, add a soft horizontal highlight bar or top/bottom border lines around the active selected row (`9:00 AM` and `5:00 PM`).
* **Typography:** Set active selected time strings (`9:00 AM`, `5:00 PM`) to bold `<color-brand-primary>` or dark black, while dimming unselected adjacent times (`8:30 AM`, `9:30 AM`) to low-opacity gray (`0.4`).

### 4. Primary CTA
* Ensure the bottom button 'Save area for Justin' has a high-trust shield icon on the left, heavy font weight, and standard `0 4px 14px rgba(124, 93, 250, 0.35)` drop shadow.
# Claude UI/UX Polish Prompt: Screen 12 (Geofencing Success Modal)

**Context:** Connected to ORBII Safety UI project. Elevating completion state feedback. Reference `image_2.png`.

**Instructions:** Please apply the following UI improvements to the Geofencing Success Modal (`GeofenceSuccessModal.tsx`):

### 1. Copywriting & Grammar Correction
* Fix the body copy text template:
  * **Current:** "...if [Name] leave [Area] between..."
  * **Updated:** "...if **[Name] leaves \"[Area]\"** between [Start Time] and [End Time]."

### 2. Modal Header Icon Elevation
* Modify the circular shield icon at the top of the modal:
  * Wrap the icon in a soft, dual-layer animated aura (outer circle pale purple `#F0EBFF`, inner icon container vibrant brand purple `#7C5DFA` with white icon).
  * Give the icon container a subtle scale-in spring animation upon open.

### 3. Typography & Spacing
* **Header:** Set 'Area saved' title to bold, heavy weight (`20px`).
* **Body:** Increase `line-height` (`1.5`) on the explanation text. Highlight variable text (`Justin`, `"College"`, `9:00 AM`, `5:00 PM`) in semi-bold dark font so key info stands out at a glance.

### 4. CTA Polish
* Set the 'Done' button to full width inside the modal padding, with heavy font weight and soft press transition.