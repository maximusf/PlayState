# PlayState Design Plan

Product: PlayState. Tagline: Find the right game for right now.

One job: get a signed-in player from "I don't know what to play" to a short list of up to 3 games from their own library, in under a minute.

## Direction

Modern product UI with restrained retro game styling. The reference point is a game's select screen (cursor, chunky tiles, save slots), not an emulator skin.

Signature element: the picker is a select screen. Every option is a tile with stepped pixel corners. The chosen tile fills with green and shows a small cursor marker. Results arrive as three ranked "slots".

Pixel styling is used only for: the logo mark, headings and small labels, tile and card frames, the loading indicator, badges, and empty-state art. Body text, forms, and layout stay clean and modern.

## Information architecture

```text
/                 Landing (public)
/sign-in          Clerk sign in (public)
/sign-up          Clerk sign up (public)
/library          Saved games (signed in)
/library/add      Search the catalog and add games (signed in)
/pick             Picker and results (signed in)
```

Header on every page: wordmark (home link), then Library, Pick, and the account button when signed in, or Sign in when signed out.

## Screen flow

```text
Landing -> Sign up / Sign in -> Library (empty) -> Add games -> Library -> Pick -> Results
                                                                  ^                   |
                                                                  +---- Pick again ---+
```

## Layout

Mobile first, single column, content capped at 64rem and centered. 16px side gutter on phones, 24px from tablet up.

```text
Landing (desktop)                      Pick (phone)
+----------------------------------+   +------------------+
| logo            Sign in          |   | logo   Lib Pick  |
+----------------------------------+   +------------------+
| Find the right   | +-----------+ |   | How much time?   |
| game for right   | | > 1-2 hrs | |   | [<30][30-60]     |
| now.             | | Strategy  | |   | [1-2h][2h+][Any] |
| [Get started]    | | Slot 1 .. | |   | What sounds good?|
|                  | +-----------+ |   | [tiles, 2 col]   |
+----------------------------------+   | How to play?     |
                                       | [Solo][Multi][Either]
                                       | [ Find games ]   |
                                       +------------------+
```

- Library: cover grid, 2 columns on phones, up to 5 on desktop.
- Add game: search field and button on one row, results as a vertical list of rows (cover, title, year, genres, Add).
- Pick: three fieldsets stacked. Results render below the form on the same page and receive focus.

## Color tokens

Defined once in `apps/web/src/app/globals.css` as Tailwind theme tokens.

| Token | Hex | Use |
|---|---|---|
| `paper` | `#FAFBF8` | Page background |
| `surface` | `#FFFFFF` | Cards, inputs |
| `sage` | `#D9EAD7` | Quiet fills, placeholders |
| `mint` | `#A7F3D0` | Selected fills, badges |
| `emerald` | `#10B981` | Primary actions, focus |
| `leaf` | `#22C55E` | Accents, cursor, hover |
| `forest` | `#0F2D23` | Headings, frames, text on green |
| `slate` | `#1F2937` | Body text |
| `muted` | `#4B5B55` | Secondary text |
| `danger` | `#B42318` | Errors, destructive actions |

Contrast rules: body text is `slate` on `paper`. Text on `emerald`, `leaf`, or `mint` is always `forest`, never white. No purple anywhere.

## Typography

| Role | Face | Notes |
|---|---|---|
| Display | Pixelify Sans (OFL) | Wordmark, page headings, small uppercase labels, badges |
| Body | Figtree (OFL) | Everything else |

Both load through `next/font`, which self-hosts them at build time (no runtime request to Google, no extra npm dependency). The pixel face is never used for paragraphs, form values, or error messages.

Scale: 14 / 16 / 18 / 24 / 32 / 48 (hero only, 36 on phones). Labels in the pixel face are 12 to 14px, uppercase, with wide tracking.

## Spacing and shape

4px base grid, which doubles as the "pixel" size. Frames are 4px stepped corners drawn with box shadows. Primary buttons carry a 4px hard drop shadow and move down 2px when pressed. No blurred shadows, no gradients.

## Components

- `Logo`: pixel play-arrow mark plus wordmark.
- `SiteHeader`: wordmark, nav, account.
- Button styles: primary (emerald), secondary (white), danger text.
- `OptionTile`: a real radio or checkbox input with a tile label. Selected state uses fill, a cursor marker, and a heavier frame, so it never depends on color alone.
- `GameCover`: cover image with a pixel placeholder when IGDB has no art.
- `PixelLoader`: three stepping blocks with a text label.
- `Notice`: inline message for errors and confirmations.
- `EmptyState`: small pixel illustration, one sentence, one action.

## UX behavior

- Picker defaults: Any time, no types selected (means anything), Either. A player can press Find games immediately.
- Types are multi-select. Time and mode are single-select.
- Results show plain reasons such as "Matches Strategy" and "Supports single-player". No percentages or scores.
- "Choose this" marks one result as the pick. "Pick again" reruns with the same answers.
- Add game: Add buttons switch to "Added" in place. A duplicate shows "Already in your library" on that row.
- Remove is immediate, with the row disabled while the request runs.

## States

| State | Treatment |
|---|---|
| Loading | `PixelLoader` with a label ("Loading your library", "Searching", "Finding games") |
| Empty library | Illustration, "Your library is empty.", Add a game |
| Empty search input | Inline hint, no request sent |
| No search results | "No games found for ..." with a hint to try another title |
| Catalog unavailable | "The game catalog is unavailable right now. Try again in a moment." |
| API error | Message plus a Try again button |
| Duplicate add | Row-level note, not a page error |
| No match | "Nothing in your library fits that." plus a hint to loosen the answers |
| Empty library on Pick | Explains why and links to Add a game |

## Responsive behavior

- Tap targets are at least 44px tall.
- Option tiles are 2 columns on phones, 3 to 4 on wider screens.
- The header keeps Library and Pick visible at every width (two short links fit on a phone).
- Nothing relies on hover.

## Accessibility

- Semantic landmarks, one `h1` per page, fieldsets with legends in the picker.
- All controls are native buttons, links, and inputs, so keyboard support is built in.
- A 3px focus ring in `forest` with an offset on every focusable element.
- Status messages use `role="status"` or `role="alert"`.
- Cover images have alt text with the game title. Decorative pixel art is hidden from assistive tech.
- Motion is limited to the loader and the cursor blink, both disabled under `prefers-reduced-motion`.
