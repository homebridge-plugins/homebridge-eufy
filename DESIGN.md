---
name: Homebridge Eufy
description: The custom Homebridge settings UI that turns a Eufy household into HomeKit accessories.
colors:
  accent: '#00bfc4'
  accent-ink: '#006f73'
  on-accent: '#07383a'
  ink: '#182033'
  muted: '#667085'
  panel: '#ffffff'
  line: 'rgb(23 32 44 / 11%)'
  line-strong: 'rgb(23 32 44 / 19%)'
  ok: '#1a7f4b'
  alert: '#d99a21'
  fault: '#b42318'
  tile-bg: '#edf2f7'
  tile-ink: '#17202c'
  tile-muted: '#475569'
  tile-scene-ink: '#f4f7fb'
  tile-scene-muted: '#d6deea'
  accent-ink-dark: '#67e1e4'
  ink-dark: '#edf1f7'
  muted-dark: '#aab3c2'
  panel-dark: '#262d39'
  tile-bg-dark: '#17202c'
  line-dark: 'rgb(255 255 255 / 10%)'
  line-strong-dark: 'rgb(255 255 255 / 18%)'
  ok-dark: '#6cd39a'
  alert-dark: '#d9a53f'
  fault-dark: '#fda29b'
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 'clamp(22px, 5vw, 30px)'
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: '-0.035em'
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '18px'
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: '-0.01em'
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '17px'
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: '-0.01em'
  summary:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '15px'
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '14px'
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '12px'
    fontWeight: 500
    lineHeight: 1.25
  eyebrow:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '10px'
    fontWeight: 700
    letterSpacing: '0.11em'
rounded:
  sm: '4px'
  control: '8px'
  card: '12px'
  panel: '16px'
  pill: '999px'
spacing:
  '1': '4px'
  '2': '8px'
  '3': '12px'
  '4': '16px'
  '5': '20px'
  '6': '24px'
  '8': '32px'
components:
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.on-accent}'
    typography: '{typography.body}'
    rounded: '{rounded.control}'
    height: '44px'
    width: '100%'
  button-icon:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    size: '40px'
  input:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '8px 12px'
    height: '44px'
  status-chip:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.accent-ink}'
    rounded: '{rounded.pill}'
    padding: '4px 8px'
  panel:
    backgroundColor: '{colors.panel}'
    rounded: '{rounded.panel}'
    padding: 'clamp(16px, 5vw, 32px)'
  device-tile:
    backgroundColor: '{colors.tile-bg}'
    textColor: '{colors.tile-ink}'
    rounded: '{rounded.card}'
    padding: '16px'
  device-badge:
    rounded: '{rounded.pill}'
    size: '32px'
  segmented-control-selected:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.on-accent}'
    padding: '8px 4px'
---

# Design System: Homebridge Eufy

## Overview

**Creative North Star: "The Device Catalogue"**

The interface is a catalogue of the household's devices. On the dashboard each device is a tile, and each tile shows either a packaged product photograph, desaturated and inset on a flat ground, or the camera's own last frame filling the tile. Everything else steps back so those images carry the page: one teal accent, a neutral panel, hairline edges, and the host's system font. The UI is a guest inside Homebridge's settings page. It keeps a transparent body, follows the host's light or dark theme, and inherits `--bs-body-color` so its text levels move with the host.

Controls are tactile and confident. Every primary target is 44px tall, the primary button is filled with the accent, a press scales it to 0.97, and every state can be read without color: an attention dot beside the alert ring, a word beside the capture icon, a dot beside a status label. The sheet holds itself to written scales and treats any value off them as a defect: spacing on a 4px grid, five radius tokens, four text levels, two edge intensities, one easing curve, and one overlay shadow.

The layout is a single column of at most 720px, sized for the Homebridge settings modal. It reflows from a three-column device grid to two columns, then to a stack of 2:1 tiles on a phone.

**Key Characteristics:**

- Device imagery leads; the chrome is neutral and edge-drawn.
- One accent (teal `#00bfc4`), reserved for primary action, selection, and current position.
- Depth comes from borders. A shadow appears only on a layer floating over content it doesn't belong to.
- 44px targets, a filled accent, and a 0.97 press scale.
- Inherits the host theme; light and dark are first-class.
- No state rests on color alone.

## Colors

The palette is cool slate neutrals with one saturated teal, plus three status semantics that only ever mark state.

### Primary

- **Lagoon Teal** (`accent`): the one accent. Fills the primary button, the checked toggle, the selected segment, the current step's rule, and the edge of a hovered device tile (mixed 45% into `line-strong`). As `accent-soft` (12% over the panel, 18% in dark) it tints the first-setup callout, the handoff note, and the status chip.
- **Deep Lagoon** (`accent-ink`, dark: `accent-ink-dark`): accent text on light grounds and the color of the focus ring. It exists because the bright teal fails contrast as text.
- **Lagoon Shadow** (`on-accent`): text and icons on a filled accent. A dark teal rather than white, so the filled button reads as a single tinted object.

### Neutral

- **Slate Ink** (`ink`, dark: `ink-dark`): default text. Falls back to the host's `--bs-body-color`.
- **Supporting ink** (`ink-secondary`): `ink` mixed 78% into the panel. Used for summaries, dialog bodies, and handoff copy.
- **Slate Mist** (`muted`, dark: `muted-dark`): metadata, field labels, eyebrows, footnotes. Falls back to the host's `--bs-secondary-color`.
- **Disabled ink** (`ink-disabled`): `muted` mixed 55% into the panel.
- **Paper Panel** (`panel`, dark: `panel-dark`): every enclosed surface: panels, inputs, icon buttons, dialogs, tooltips.
- **Hairline** (`line`, dark: `line-dark`): divides and encloses. Alpha over whatever surface it sits on.
- **Firm Hairline** (`line-strong`, dark: `line-strong-dark`): the edge of a control the user has to find without searching: inputs, icon buttons, selects, segmented controls.

### Tile ground

- **Catalogue Ground** (`tile-bg`, dark: `tile-bg-dark`): the flat ground behind a product cutout.
- **Tile Ink / Tile Mist** (`tile-ink`, `tile-muted`): the device name and second line over a cutout.
- **Scene Ink / Scene Mist** (`tile-scene-ink`, `tile-scene-muted`): the name and second line over a camera frame. These are light in both themes because a scene always sits under a dark gradient.

### Status

- **Signal Green** (`ok`), **Amber Watch** (`alert`), **Ember Fault** (`fault`), each with a dark-mode counterpart. They mark live, attention, and fault states. On a tile, the status word is the semantic mixed 75% toward the ground's ink, and the dot keeps the flat color.

### Named Rules

**The One Voice Rule.** Teal is the only hue that acts. Status colors report state and never decorate, and no second brand hue exists.

**The Mixed, Not Stated Rule.** Derived levels (`ink-secondary`, `ink-disabled`, `accent-soft`, hover and disabled fills) are `color-mix()` against the panel, and they are redeclared in the dark block so they resolve against the dark panel.

**The Two Grounds Rule.** Copy over a product cutout takes the tile's ink. Copy over a camera frame takes the scene ink, whatever the theme.

## Typography

**Display Font:** the system UI stack (`ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`)
**Body Font:** the same stack
**Label/Mono Font:** none. Numbers use `font-variant-numeric: tabular-nums` where they change: the status chip, step counters, and inputs.

**Character:** native and legible. The type matches the host platform so the plugin reads as part of Homebridge, and hierarchy comes from weight, tracking, and case rather than from a second family.

### Hierarchy

- **Display** (`typography.display`): the page title in the masthead. Tight negative tracking, balanced wrap.
- **Headline** (`typography.headline`): panel, dialog, and callout titles.
- **Title** (`typography.title`): the device name on a tile. Single line with an ellipsis.
- **Summary** (`typography.summary`): the lead sentence under a panel title, in supporting ink.
- **Body** (`typography.body`): everything else; `text-wrap: pretty` on paragraphs.
- **Label** (`typography.label`, 11–12px, weight 500–600): field labels, tooltips (10–11px), segmented options (10px / 600), and the diagnostics tiles.
- **Eyebrow** (`typography.eyebrow`, uppercase): the kicker above a title. Device group headings use the same treatment at 13px with 0.08em tracking.

### Named Rules

**The Four Weights Rule.** 400 body, 500 label, 600 emphasis, 700 heading. No other weight appears.

**The Four Levels Rule.** Text uses exactly four levels: ink, supporting, muted, disabled. Never invent a fifth gray.

## Layout

The page is one column, `min(100%, 720px)` wide and centered, with 4px top and 20px bottom padding. Panel padding scales with `clamp(16px, 5vw, 32px)`. All spacing sits on the 4px grid (`spacing` tokens); 2px appears only as an optical nudge, never as a gap.

The device grid is the signature layout. It is a container-query grid of three columns with 12px gaps, and its row height is half a column (`calc(((100cqw - 24px) / 3 - 12px) / 2)`). A camera spans two rows, so it is exactly square. Every other device spans one row, and `grid-auto-flow: row dense` packs two short tiles into the height of one camera.

Breakpoints:

- **≤760px:** two columns, with the row unit recomputed.
- **≤540px:** the warm-up transfer stacks its lists vertically and rotates its chevrons 90°.
- **≤520px:** a single column. Tiles drop the row unit and take a 2:1 aspect ratio (min-height 152px). Paired actions stack.
- **≤420px:** diagnostics tiles go to two columns, the diagnostics action shows its icon only, and field rows stack.

## Elevation & Depth

The system is flat. Borders carry structure: `line` encloses panels and tiles, `line-strong` marks controls. Exactly one shadow token exists, and it belongs only to a layer that floats over content it doesn't own: tooltips and the blocking dialog. In dark mode that shadow collapses to a 1px white ring at 9% opacity.

### Shadow Vocabulary

- **Overlay** (`box-shadow: 0 0 0 1px rgb(23 32 44 / 6%), 0 4px 12px rgb(23 32 44 / 10%)`): tooltips and the blocking dialog.
- **Toggle knob** (`box-shadow: 0 1px 2px rgb(0 0 0 / 22%)`): states the knob's physical position. A documented exception.
- **Badge halo** (`filter: drop-shadow(0 1px 2px rgb(4 8 14 / 85%))`): separates the unplated battery glyph from unknown artwork. A documented exception.
- **Attention ring** (`box-shadow: 0 0 0 2px` alert at 24%): a state ring on an icon button, not elevation.

### Named Rules

**The Depth Is Edges Rule.** A border carries structure; only a floating layer carries a shadow. A new shadow needs a stated reason in the sheet.

## Shapes

Corners are gently rounded, and the radius grows with the size of the container: 4px for items inside a list, 8px for controls, 12px for cards and tiles, 16px for panels and dialogs, and a pill for chips, badges, toggles, and status dots. Nested radii are concentric, so a list item's 4px radius is the list's 8px minus its 4px padding. Callouts (first setup, handoff) add a 4px accent rule on the leading edge, and the first-setup callout adds a chevron that points into the page.

**The Radius Is a Token Rule.** No rule states a radius as a literal; every radius is one of `rounded.sm`, `control`, `card`, `panel`, or `pill`.

## Components

### Buttons

Tactile and confident: full-width, filled, and firm under the finger.

- **Shape:** gently rounded (`rounded.control`), 44px minimum height.
- **Primary:** accent fill, `on-accent` text, weight 600. This is the default `button` style. A variant has to opt out of it.
- **Hover / Active:** fill mixes 88% accent toward `on-accent`; a press scales to 0.97 over 100ms (turned off under reduced motion). Transitions run 150ms on `--ease-out`, `cubic-bezier(0.23, 1, 0.32, 1)`.
- **Disabled:** accent at 28% over the panel, text at 60%, `not-allowed` cursor.
- **Icon action:** a 40px square on the panel with a `line-strong` edge and a 20px icon at 72% opacity. It shows a tooltip from its `aria-label` and tints 9% accent on hover. When attention is needed it takes the alert edge, a 2px ring, and a corner dot. While capturing it shows a word beside the icon on a 16% accent fill.
- **Quiet:** a transparent background with ink text, for secondary choices in diagnostics.
- **Focus:** one ring everywhere: 2px solid `accent-ink`, offset 2px.

### Chips

- **Status chip:** pill-shaped, `accent-soft` ground, `accent-ink` text, 11px / 600, tabular numerals.
- **Device badges:** 32px pill plates on `tile-badge-bg` with a blur, holding a 16px icon. The battery gauge has no plate: an 18px glyph rotated -90° with a halo. A tooltip comes from `data-tooltip`.

### Cards / Containers

- **Panel:** `rounded.panel`, `panel` ground, `line` edge, fluid padding.
- **Surface / callout:** `rounded.card`. Callouts tint `accent-soft` and carry the 4px leading accent rule.
- **Blocking dialog:** a native `<dialog>`, max 420px, 24px padding, the overlay shadow, and a backdrop of black at 30% with a 5px blur. Used when the user must act, such as a session that needs a new sign-in.

### Inputs / Fields

- **Style:** 44px tall, `panel` ground, `line-strong` edge, `rounded.control`, 8px × 12px padding, tabular numerals.
- **Focus:** the edge turns accent and the shared focus ring appears.
- **Toggle:** a 36×20 pill track at `muted` 28% over the panel, holding a 14px knob. When checked the track fills with accent and the knob moves 16px over 140ms.
- **Segmented control:** three equal segments in one `line-strong` frame with `line` dividers. The checked segment fills with accent. The focus ring is drawn inset on the visible segment.
- **Select:** same metrics as an input.

### Navigation

- **Steps:** a three-column list. Each step has a 3px top rule in `line`, an 11px uppercase label, and a 10px tabular counter. The current step turns its rule accent and its text `accent-ink`.
- **Page back:** a 40px icon button with a 22px glyph.

### Device Tile (signature)

The catalogue entry. `rounded.card`, `line` edge, `tile-bg` ground. A cutout image is contained with a 24px inset and dimmed with `brightness(0.92) saturate(0.85) contrast(1.05)`. A scene image covers the tile under a gradient that reaches full strength by 78%. The name (`typography.title`) and the second line sit on a bottom gradient. The second line holds either the model or a status made of a dot and a label. A device withdrawn from HomeKit gets 45° stripes and a grayscale filter. On hover the edge picks up the accent.

### Live Preview (signature, drifting)

A 16:9 black frame split down the middle by a 2px white seam: the camera's picture on the left and the picture HomeKit gets on the right, each labeled over a top gradient. Play is a pill floated over the frame, and stop appears only on hover or keyboard focus.

## Do's and Don'ts

### Do:

- **Do** take every spacing value from the 4px grid, and every radius, edge, text level, and easing from its token.
- **Do** let device imagery carry the dashboard; keep chrome on `panel`, `line`, and the four text levels.
- **Do** pair every colored state with a non-color signal (dot, word, ring, or stripe).
- **Do** make primary targets 44px and icon actions 40px.
- **Do** redeclare any `color-mix()` token in the dark block when you add one.
- **Do** put a new interactive state in the consolidated state block near the end of `app.css`, in cascade order.
- **Do** use `tile-scene-ink` for copy over a camera frame in both themes.

### Don't:

- **Don't** introduce a second accent hue.
- **Don't** write literal radii or undefined variables; use `rounded.*` and `line`.
- **Don't** add a shadow to a resting surface; use an edge.
- **Don't** add a fifth text gray or a weight outside 400/500/600/700.
- **Don't** set a body background. The host page shows through.
- **Don't** contain or desaturate a camera frame the way a product cutout is treated.
