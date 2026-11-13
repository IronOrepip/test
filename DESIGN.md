# DESIGN.md

Brand source: `brand/nova-design-system-B.md` (wordmark B, "Turned V"). Its rules for the logo, colors and fonts are not negotiable. Layout system, section rhythm, component structure and restraint are adapted from `design-md/editorial/nespresso.md`.

Logo: always use the exact SVG from the brand file, as one flat color set with CSS `color`. Never type "NOVA" in a font.

---

### 1. Visual Theme & Atmosphere

A technical spec sheet, run with boutique restraint. Like Nespresso, the interface stays almost monochrome. Paper and white surfaces, Ink text, and one orange action per view, so photography of real products and of Ischia carries the color. Unlike Nespresso, the voice is industrial: condensed uppercase headings, monospace labels for specs and prices, thin 1px rules and near-square corners. Content sits in flat panels with no shadows, and occasional full-bleed Ink bands break up the light sections. Frosted glass appears only over photos or video, for the header bar and hero cards. The overall feel is modern, technological and calm.

### 2. Color Palette & Roles (CSS variables)

```css
:root {
  --text-primary:   #101418; /* Ink: logo, headings, body */
  --text-secondary: #5a636d; /* secondary text on light */
  --text-on-dark-2: #8b939c; /* Steel: secondary text on dark, icons */
  --text-inverse:   #f4f5f6; /* Paper */
  --bg-page:        #ffffff;
  --bg-surface:     #f4f5f6; /* Paper panels and image wells */
  --bg-inverse:     #101418; /* Ink bands, dark sections */
  --action-primary: #f2500f; /* Signal orange, Ink text on top */
  --action-primary-hover: #d9460d;
  --action-secondary: #101418;
  --border:         #8b939c; /* Steel, 1px rules */
  --border-subtle:  #e3e5e8;
  --focus-ring:     #f2500f;
  --glass-fill:     #ffffff24;
  --glass-border:   #ffffff4d;
  --scrim:          #10141880;
}
```

Ratio: 60% surface, 30% opposite neutral, 10% orange at most.

### 3. Typography Rules (scale + stack)

**Stacks**
- Display: `"Barlow Condensed", "Arial Narrow", Arial, sans-serif;` weight 600, uppercase.
- Body/UI: `Barlow, Arial, sans-serif;` weights 400, 500, 600.
- Labels: `"IBM Plex Mono", ui-monospace, Menlo, monospace;` 400 and 500.

All from Google Fonts (open license). The scale follows Nespresso's steps.

| Token | Desktop | Mobile (<=767px) | Family / weight | Line height | Tracking |
|---|---|---|---|---|---|
| display-xl | 48px | 36px | Condensed 600 | 1.1 | 0.02em |
| display-lg (section title) | 40px | 32px | Condensed 600 | 1.1 | 0.02em |
| display-md (card title) | 30px | 26px | Condensed 600 | 1.15 | 0.01em |
| title | 20px | 20px | Barlow 600 | 1.3 | 0 |
| body | 16px | 16px | Barlow 400 | 24px | 0 |
| ui / nav | 15px | 14px | Barlow 500 | 1.2 | 0 |
| label | 12px | 12px | Plex Mono 500, uppercase | 1.4 | 0.1em |

### 4. Component Stylings (button, card, input, nav)

**Button:** 4px radius, 1px border, Barlow 600, 8px gap. Large: 48px high, `12px 24px`. Small: 32px, `6px 16px`, 14px.
- Primary ("Request a quote"): `#f2500f` bg, `#101418` text, hover `#d9460d`. Only one per view.
- Secondary: `#101418` bg, `#f4f5f6` text; inverts on hover (reversed on dark).
- Outline: 1px `#101418`, hover tint `#1014181a`.
- Disabled: opacity 0.3. Focus: `0 0 0 2px #f2500f`.

**Card:** `#f4f5f6`, 4px radius, 1px `#e3e5e8` border, 32px padding, no shadow. Product card: 4px image well, Barlow 600 name, Plex Mono label for code and price, a square 32px Ink add button.

**Input:** 48px high, 1px `#8b939c` border, 4px radius, Barlow 16px. Focus: Ink border plus orange ring. Label above in Plex Mono 12px uppercase.

**Nav:** white bar (glass over hero media), Barlow 500 links, 2px orange underline on the active link, 200ms.

### 5. Layout Principles (grid, max-width, spacing scale)

**Content width:** 1150px max (1160px for mega-menus). Gutters are 24px on desktop and 16px on mobile. Text blocks stay within about 65 characters (max 580px for centered intros).

**Spacing scale (px), steps 0 to 10, on the 8px unit:**
`0, 2, 4, 8, 16, 24, 32, 40, 64, 80, 120`.
On mobile each step from 5 up drops one level (step 10 becomes 80, step 8 becomes 40).

**Section rhythm:** 64px to 80px vertical padding on desktop, 40px on mobile. Left-aligned by default. Center only a short section intro.

**Grid:**
- Category tiles: 3 columns with a 16px gap.
- Editorial mosaic: one large tile beside two stacked tiles, 16px gap.
- Product rows: horizontal carousel with a thin Ink progress bar and square prev/next buttons.
- Spec tables: full width, 1px Steel rules, Plex Mono values.

### 6. Depth & Elevation

The interface is flat. Depth comes from tone and borders, never from drop shadows.

- **Level 0:** page `#ffffff`.
- **Level 1:** Paper `#f4f5f6` panels with 1px `#e3e5e8` borders.
- **Level 2 (dark):** full-bleed Ink `#101418` bands. Panels on them use 1px `#8b939c` borders.
- **Glass (over media only):** `#ffffff24` fill, 1px `#ffffff4d` border, 14px radius, `backdrop-filter: blur(16px) saturate(160%)`. On plain backgrounds use solid surfaces instead.
- **Modal / drawer:** solid white, 1px border, and a `#10141880` scrim. No shadow.
- **Focus:** `0 0 0 2px #f2500f`.

**Motion:** button colors 80ms ease-in-out; nav underline and submenus 200ms ease-out with a -4px translate-in; images fade in over 300ms.

### 7. Do's and Don'ts

**Do**
- Use the exact logo SVG in one flat color: Ink on light, Paper on dark, Ink on orange.
- Keep chrome monochrome and let real product and Ischia photos bring the color.
- Use one orange "Request a quote" button per view, with Ink text.
- Set specs, codes and prices in IBM Plex Mono uppercase labels.
- Alternate light sections with an occasional full-bleed Ink band.

**Don't**
- Retype the logo, add a crossbar to the A, or put it on a busy background without glass or a scrim.
- Use drop shadows, gradients outside glass, or any purple-gradient default.
- Use pill buttons or corners above 4px, except 14px on glass panels.
- Put orange text on white at small sizes (3.5:1 fails AA).
- Use stock warehouses, 3D renders or invented customer claims.

### 8. Responsive Behavior

**Breakpoints:** `<=767px` (mobile), `768-995px` (tablet), `>=996px` (desktop), `>=1140px` (full desktop nav).

**Changes by size:**
- **Navigation:** below 1140px it collapses to a full-height drawer with 48px rows, 1px Steel dividers and back buttons per level. The "Request a quote" button stays visible in the bar.
- **Typography:** display sizes step down one level (40 to 32, 30 to 26). Labels stay at 12px.
- **Spacing:** utilities drop one step on mobile, and gutters shrink from 24px to 16px.
- **Grids:** 3- and 4-column grids fall back to 1 or 2 columns. Carousels stay horizontal and swipeable, with the next card peeking in.
- **Logo:** never below 64px wide. Use the glass logo only in the hero and only at 160px wide or more.

### 9. Agent Prompt Guide

**Use these phrases in prompts:**
- "Technical spec sheet with boutique restraint."
- "White and Paper `#f4f5f6` surfaces, Ink `#101418` text."
- "Barlow Condensed 600 uppercase headings, Barlow body, IBM Plex Mono labels."
- "Flat panels, 1px borders, 4px corners, no shadows."
- "One Signal orange `#f2500f` 'Request a quote' button per view, Ink text."
- "1150px content column, spacing on a 4/8/16/24/32/40/64/80/120 scale."
- "Exact NOVA SVG logo, one flat color."

**Sample prompt:**
"Build a product row for hotel suppliers: a left-aligned 40px condensed uppercase title, a Plex Mono category label, and a carousel of Paper cards with code and price labels and a square Ink add button."

**Reject:**
- any output that retypes or restyles the logo;
- drop-shadowed cards;
- gradient or purple accents;
- pill buttons;
- more than one orange button per view;
- stock or 3D imagery.

Regenerate instead of shipping it.
