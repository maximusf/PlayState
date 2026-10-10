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
/library/[id]     One game: cover, summary, tags, remove (signed in)
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

Mobile first, single column, content capped at 72rem and centered. 16px side gutter on phones, 24px from tablet up.

```text
Landing (desktop)                        Pick, one question (phone)
+------------------------------------+   +--------------------+
| logo                      Sign in  |   | logo     Lib Pick  |
+------------------------------------+   +--------------------+
| Find the right  | Tonight [2h+]..  |   | Question 2 of 3    |
| game for right  | +--------------+ |   | [###][###][   ]    |
| now.            | | shelf of 12  | |   | So far: [2h+ Change]|
| [Get started]   | | covers, 3    | |   | What sounds good?  |
|                 | | lit as picks | |   | [tiles, 2 col]     |
+------------------------------------+   | ..................  |
| 1 Build   2 Answer   3 Get picks   |   | [Back]      [Next] |
+------------------------------------+   +--------------------+
```

- Landing: headline and actions beside a shelf of twelve IGDB covers, nine dimmed and three lit as picks, then a three-step "how it works" row.
- Library: cover-first tiles, 2 columns on phones, up to 5 on desktop. Each tile links to the game's page. A row of genre filters appears when the library has more than one genre. The grid ends with an "Add a game" tile.
- Game page: large cover beside the title, release year, IGDB summary, and genre, theme, and mode tags. A row of four buttons asks how long the player usually plays it, and the picker trusts that answer over its own guess. A box lists the picker choices that can suggest the game. Remove lives here.
- Add game: search field and button on one row, results as a vertical list of rows (cover, title, year, genres, Add).
- Pick: one centered question per screen with a three-segment progress bar. Earlier answers show as chips that jump back to that question. Back and Next sit in a bar under the tiles, and the last question's button reads "Find games".
- Results: replace the questions. Up to three cover-first cards side by side, with the answers as chips and "Change answers" and "Pick again" beside the heading.

## Color tokens

Defined once in `apps/web/src/app/globals.css` as Tailwind theme tokens.

| Token | Hex | Use |
|---|---|---|
| `paper` | `#D9EAD7` | Page background |
| `surface` | `#FAFBF8` | Header, cards, inputs |
| `sage` | `#D9EAD7` | Same value as the page, kept for small fills |
| `fern` | `#8FB58C` | Quiet frames, dotted rules, unselected tiles |
| `pine` | `#065F46` | Green text and numerals on light backgrounds |
| `mint` | `#A7F3D0` | Selected fills, badges |
| `emerald` | `#10B981` | Primary actions, focus |
| `leaf` | `#22C55E` | Accents, cursor, hover |
| `forest` | `#0F2D23` | Headings, frames, text on green |
| `slate` | `#1F2937` | Body text |
| `muted` | `#3F4D47` | Secondary text |
| `danger` | `#B42318` | Errors, destructive actions |

Contrast rules: body text is `slate` on `paper`. Text on `emerald`, `leaf`, or `mint` is always `forest`, never white. No purple anywhere.

## Typography

| Role | Face | Notes |
|---|---|---|
| Display | Jersey 10 (OFL) | Wordmark, page headings, small uppercase labels, badges |
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

- Picker defaults: Any time, no types selected (means anything), Either. A player can press Next twice and Find games without changing anything.
- Types are multi-select. Time and mode are single-select.
- Results show plain reasons such as "Matches Strategy" and "Supports single-player". No percentages or scores.
- "Choose this" marks one result as the pick, fades the other two, and links to that game's page. The choice is saved with the time answer, so later picks can learn from it.
- "Pick again" reruns with the same answers and leaves out games already shown. When every match has been shown, it says so and the next press starts over.
- Add game: Add buttons switch to "Added" in place. A duplicate shows "Already in your library" on that row.
- Remove is on the game page. It is immediate, the button is disabled while the request runs, and the player returns to the library.
- Library filters only hide tiles. They never change what the picker considers.

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
