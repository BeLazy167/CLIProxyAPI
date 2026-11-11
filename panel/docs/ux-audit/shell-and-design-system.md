# UX audit: Shell and design system

Audited 2026-10-07 against the Quota Management page as the quality bar. Audit only; no source changes. Layout claims come from reading the code; contrast values were computed.

## 1. Summary

The app has one strong visual language, and the Quota, Credential Vault (auth files) and Config pages express it well. That language is not in the shared layer. `components.scss` still ships an older gray-pill button, a plain card and a plain empty state, and the best patterns are copy-pasted per page. Each of Quota, Vault and Config re-declares the ink-pill header actions, the page header, its own spin keyframes and the error banner. Logs, Plugins, Plugin Store, OAuth, System and Providers use a different header (28px title plus description, no meta line). Tokens cover color well but not radius, type or spacing: there are 131 literal radii against 50 token uses, and 455 literal font sizes against 18 token uses. The light theme has real contrast problems on the status and secondary text colors. Overlays work but diverge: Modal animates differently from Sheet, has no reduced-motion handling, and duplicates about 120 lines of focus-trap code. i18n has a Chinese fallback for every other language and some drift between locales. The fix is extraction and token tightening, not a redesign.

## 2. Findings

Ordered by impact. Line numbers are in the repo under `src/`.

| # | Sev | Finding | File:line | Recommendation |
|---|---|---|---|---|
| 1 | High | Page header pattern is forked. Quota, Vault and Config use the h1 `clamp(26px,3.2vw,30px)`/700, a mono `▍` meta line and pill actions. Logs, Plugins, Plugin Store, OAuth, System, Providers and Dashboard each define their own title (28px, 30px, or 80px hero), with no meta line. | `features/quota/components/QuotaHeader.module.scss:20-55`, `features/authFiles/components/VaultHeader.module.scss:20`, `features/config/components/ConfigHeader.module.scss:20`, `features/logs/LogsPage.module.scss:21`, `features/plugins/PluginsPage.module.scss:21`, `features/providers/components/ProviderHeaderCard.module.scss:29`, `pages/OAuthPage.module.scss:28`, `pages/SystemPage.module.scss:5` | Extract `PageHeader` (title, `MetaLine` segments with tone, `actions` slot). Migrate the 7 outliers. |
| 2 | High | Light-theme text contrast fails AA. Computed ratios: `--text-tertiary` 2.58:1 on the page background and 2.34:1 on cards, `--text-quaternary` 1.83:1, `--success-color` as text 2.4:1, `--quota-medium-color` 1.82:1 on cards. These carry the Quota meta line (`metaLoaded` uses `--viz-success` as text), plan labels and muted reset lines. | `styles/themes.scss:19,20,33,34`, `features/quota/components/QuotaHeader.module.scss:384-386` | Add `--success-text` and `--warning-text` per theme. Darken light `--text-tertiary` to about #7a746d (check it reaches 4.5:1). Keep the bright values for fills and bars only. |
| 3 | High | There are two button systems. The shared `.btn` primary is gray (#8b8680) with white text, 3.61:1 contrast. The pages use the ink pill (`--text-primary` background) and re-declare it in 6 modules. `Button` has no default `type="button"`, so it submits inside forms. `.btn` has no `:focus-visible` style. The dark override forces `color:#fff`. `btn-sm` is 14px while the quota controls are 12.5-13px. | `styles/components.scss:4-85`, `components/ui/Button.tsx:35`; pill copies in `QuotaHeader.module.scss:86`, `VaultHeader.module.scss:84,126`, `ConfigHeader.module.scss:84`, `FloatingSaveBar.module.scss:109`, `SponsorQuickStartPanel.module.scss:187` | Make the ink pill the `primary` variant. Add `shape="pill"`, `icon` and `xs` sizes, a default `type="button"` and a `:focus-visible` ring. Drop the hardcoded `#fff` in the dark override. Delete the 6 copies. |
| 4 | Med | Modal motion breaks the app's own motion rules. Entry uses an overshoot bezier at 300ms. Exit is `scale(0)` over 350ms. The tokens say UI motion stays at or under 300ms with `--ease-out-strong`. `components.scss`, `layout.scss` and `global.scss` have no `prefers-reduced-motion` block, so modal, spinner and sidebar animate regardless. 21 SCSS files animate without a reduced-motion rule. | `styles/components.scss:262-305,199-223`, `Modal.tsx:25` | Use `--dur-*`/`--ease-out-strong`, fade plus a 6px rise, 160ms exit. Add one global reduced-motion block. |
| 5 | Med | `Input` bug: `{...rest}` is spread after `aria-describedby`. A caller-supplied `aria-describedby` replaces the computed hint/error ids, so the error is no longer announced. The error box has no `role="alert"`. The wrapper and right element use inline styles. `.input` has no `:disabled` or `[aria-invalid]` style. | `components/ui/Input.tsx:37-47,59` | Spread `rest` first, or merge the ids. Add `role="alert"`, an invalid border and a disabled style. Move the inline styles to a module. |
| 6 | Med | `ConfirmationModal` swallows failures: a rejected `onConfirm` is only `console.error`'d. The modal stays open with no feedback. Layout uses inline styles instead of the Modal `footer` slot. Initial focus lands on the floating close X rather than the safe action. | `components/common/ConfirmationModal.tsx:34,55-59` | Show an inline error in the modal body (or a toast). Use the `footer` slot. Focus Cancel for `variant="danger"`. |
| 7 | Med | Token coverage is thin. Only `--radius-md` exists as a CSS variable. Radius `10px` appears 33 times (not on the 4/8/12 scale), plus 14, 9, 7, 6, 5 and others. Font sizes include 12.5, 11.5, 10.5 and 13.5 (about 11 distinct sizes). 757 literal px values in gap/padding/margin. Even the Quota module hardcodes `10px`, `12px`, `14px` and `12.5px`. | `features/quota/QuotaPage.module.scss:56,195`, `QuotaPools.module.scss:21`, `styles/variables.scss:20-30` | Add CSS vars `--radius-sm/md/lg/xl` (4/8/12/16) with 10px mapped to `md`+. Add a type scale: `--fs-meta` 11.5, `--fs-body` 12.5, `--fs-base` 13, `--fs-title` 14, `--fs-stat` 26. Migrate opportunistically. |
| 8 | Med | Color roles collapse. `$warning-color` and `$error-color` are the same value (#c65746), so `.status-badge.warning` renders red. Real amber exists only under `--amber-*`/`--quota-medium-color`. | `styles/variables.scss:8-9`, `styles/themes.scss:35-36,64-67`, `styles/components.scss:173` | Define `--warning-color` as amber, `--danger-color` as red, `--success-color` as green. Add `-text`, `-bg` and `-border` for each. |
| 9 | Med | Copy-paste debt. 13 spin/pulse/shimmer keyframes (`quota-spin`, `ledger-spin`, `vault-spin`, `config-header-spin`, `pwc-spin` and others). 7 separate error-box definitions (`error-box`, `errorBanner` x2, `errorBox` x4). Pagination markup and styles are duplicated between Quota and AuthFiles, and so are the search field and the page/workbench gap rules. | `styles/components.scss:216`, `features/quota/QuotaPage.module.scss:188`, `features/authFiles/AuthFilesPage.module.scss:28`, `features/plugins/PluginsPage.module.scss:38`, `PluginStorePage.module.scss:38`, `sharedForm.module.scss:282`, `pages/LoginPage.module.scss:218` | Add shared `ErrorBanner`, `Pagination`, `SearchField` and one `@keyframes spin` with a `.spinning` utility. |
| 10 | Med | The compact quiet Select the owner likes lives in page CSS as an attribute-selector override (`button[aria-haspopup='listbox']`, 36px, transparent). `Select size="sm"` is 28px with a shadow border, so the "small control" differs from what Quota shows. AuthFiles toolbar has its own variant. | `features/quota/QuotaPage.module.scss:130-156`, `components/ui/Select.module.scss:52-57`, `features/authFiles/components/AuthFilesToolbar.module.scss:195` | Add `Select variant="quiet"` (36px, 40px on mobile, transparent border, hover tint, focus ring). Remove the page overrides. |
| 11 | Med | Header Language and Theme menus use `role="menu"`/`menuitemradio` but only handle Escape and outside click. There are no arrow keys, no roving focus and no return of focus to the trigger. Both popovers carry dead global classes `notification entering` (no matching global rule). | `components/layout/MainLayout.tsx:1041-1052,1081-1092` | Add roving arrow/Home/End handling and refocus the trigger on close. Or drop `role="menu"` and use a plain radio group. Remove the dead classes. |
| 12 | Med | Error feedback is inconsistent. Error toasts use the same 3000ms as success and `IconInfo`, the same icon as info (about 44+ error toasts). Page-load failures use five different inline boxes. The toast text for `refresh_failed: <reason>` disappears before a long reason can be read. | `utils/constants.ts:48`, `components/common/NotificationContainer.tsx:21` | Errors: 8s or sticky until dismissed, with `IconAlertTriangle`. Rule: toast for action results, inline `ErrorBanner` for load failures. |
| 13 | Med | `ToggleSwitch` has no `:focus-visible` style. The native input is 0x0 and invisible, and the track shows no focus ring. 17 uses, all invisible to keyboard users. | `components/ui/ToggleSwitch.module.scss:17-21` | Add `.root input:focus-visible + .track { outline: var(--focus-ring) }`. |
| 14 | Med | Modal and Sheet diverge with no usage rule. The focus trap, scroll lock, restore-focus and close timer are duplicated across the two files. Modal lacks outside-click close, `confirmClose`, and `h2` semantics (title is a `div`). Sheet has `eyebrow`/`description`. Modal is used 15 times, Sheet 6. | `components/ui/Modal.tsx:46-176`, `components/ui/Sheet/Sheet.tsx:69-196` | Extract a `useDialog` hook. Rule: confirm and 1-3 field prompts use Modal, entity edit and detail use Sheet. Make Modal's title an `h2`. |
| 15 | Med | i18n robustness. `fallbackLng` is `zh-CN`, so an English, Russian or Vietnamese user with a missing key sees Chinese. Locale drift against en: ru missing 8, zh-CN missing 6, zh-TW missing 8 (31 extras). Several confirm titles (`auth_files.delete_title` and 6 siblings) exist in no locale and rely on English `defaultValue`. `AuthFileModelsModal` ships Chinese `defaultValue`s. | `i18n/index.ts:23`, `features/authFiles/hooks/useAuthFilesData.ts:325,377`, `features/authFiles/hooks/useAuthFilesOauth.tsx:200,248,325,482`, `features/authFiles/components/AuthFileModelsModal.tsx:29-80` | Set `fallbackLng: 'en'`. Add the missing keys. Add a CI script that diffs locale key sets. |
| 16 | Low | Hardcoded English in the shell: `'Back'`, `'Loading...'` defaults, brand string, logo alt `"CPAMC logo"`, and `defaultValue` on sidebar toggle keys that already exist. | `components/common/SecondaryScreenShell.tsx:26,30`, `MainLayout.tsx:352,968-969,1155` | Use `t('common.back')`/`t('common.loading')` (keys exist). Translate the alt text. Remove the redundant defaults. |
| 17 | Low | The theme is applied in a `useEffect` and `index.html` has no inline theme script, so dark-theme users can see a light first paint. Sidebar collapsed state is `useState(false)` and not persisted. | `App.tsx:42-45`, `index.html:12`, `MainLayout.tsx:329` | Add a 6-line inline script that sets `data-theme` before paint. Persist `sidebarCollapsed` in localStorage. |
| 18 | Low | Focus rings are inconsistent. The global input uses a 3px 18% box-shadow, `.btn` uses the browser default, Quota uses a 2px solid ring with offset 2, layout uses a 24-26% shadow, and `button-reset` uses `:focus` rather than `:focus-visible`. 17 rules set `outline: none`. | `styles/components.scss:99-103`, `styles/mixins.scss:36-47`, `styles/layout.scss:136,198,259,302` | One `--focus-ring: 2px solid var(--primary-color)` token. A global `:focus-visible` base rule. Switch `button-reset` to `:focus-visible`. |
| 19 | Low | The floating global cluster (refresh, language, theme, logout) sits at `top: 24px`, about 50px tall, while page content starts at `padding-top: 70px`. The page-level actions at the right of the header appear to collide or crowd it by a few px. The global refresh duplicates the page's own refresh (Quota's Refresh all). Icon-only buttons rely on `title` with no `aria-label`. | `styles/layout.scss:143-165,807-812`, `MainLayout.tsx:1019-1026,1134` | Raise `padding-top` to `var(--header-height)` on desktop. Add `aria-label` to the refresh and logout buttons. Consider moving logout into the theme/language area. |
| 20 | Low | Loading patterns are mixed: `Skeleton` in 5 places, `LoadingSpinner` in 17. `LoadingSpinner` is `role="status"` with no label. `ProtectedRoute` shows a bare spinner. | `components/ui/LoadingSpinner.tsx:9-13`, `router/ProtectedRoute.tsx:139-145` | Skeletons for lists, cards and ledgers. Spinner only for inline button or small-area waits. Give it a visually hidden label. |
| 21 | Low | `z-index` literals bypass the scale: Sheet `2000` vs `$z-modal`, Select dropdown `2010`, a `9999`, plus a `!important` on sheet width and `100vw` where `100dvh` is used elsewhere. Breakpoints: one mixin (768/1024) but ad-hoc 900 (7 uses), 760, 540, 520, 480 elsewhere. | `components/ui/Sheet/Sheet.module.scss:10,174`, `components/ui/Select.tsx:40` | Use `$z-modal`, add `$z-popover`. Add a `mixin narrow` at 900 or normalize those to 768/1024. |
| 22 | Low | `themes.scss` triples about 75 lines for light, white and dark; white differs from light in about 8 values. Each block redeclares `--radius-md`. 38 `toLocale*`/`Intl` calls use the browser locale rather than the selected app language. | `styles/themes.scss:6,96,166`, e.g. `features/logs/LogsPage.tsx:~470` | Let `[data-theme='white']` override only its deltas. Format dates with `i18n.language`. |

Findings count: 22 (3 High, 12 Med, 7 Low).

## 3. Pattern spec (derived from Quota)

### Page header
- Structure: `<header>` flex, `align-items: flex-end`, `justify-content: space-between`, `gap: 16px 24px`, wraps on mobile (stacked, actions left-aligned).
- Title: `h1`, `clamp(26px, 3.2vw, 30px)`, weight 700, `letter-spacing: -0.02em`, line-height 1.15, color `--text-primary`. Title to meta gap is 7px.
- Meta line: a `<p>` in `$font-mono` 13px/500, tabular numbers, letter-spacing 0.02em. A `▍` cursor in `--viz-success` leads it. Segments are separated by a `·` in `--text-quaternary`. Tone per segment: total is secondary, healthy count is success text, attention count is failure text, empty is tertiary. Pages without counts (System, Logs) use one segment as a status string.
- Actions: pill buttons (`$radius-full`). The primary is the ink pill (`--text-primary` background, `--bg-secondary` text, 13.5/600, 10px 18px). The secondary is an outline pill (13/500, 9px 16px, `aria-pressed` for toggles). At most one primary. The refresh icon spins while loading. Shared `Button shape="pill"` should implement this.
- Reveal: `data-reveal` on title, meta and actions through `useRevealGroup` (70ms stagger).

### Toolbar
- Row gap 8px 16px, wraps. Search field: 36px (40px on mobile), radius 10 mapped to `--radius-md`+, transparent border over `--bg-secondary`, 13px text, leading search icon, clear X (32px), focus-within ring. Quiet `Select`s at 36px for sort and view. Provider tabs go in a row above the toolbar.
- Workbench gap 14px, page gap 20px (16px on mobile).

### List and ledger row
- Group head: 14px/600 title plus a 12px tertiary count.
- Row grid: `minmax(170px, 250px) minmax(0, 1fr) auto`, gap `8px 20px`, padding `12px 0`, `border-bottom: 1px solid var(--border-color)`, no border on the last row. At 1024px and below it becomes two columns with the body on its own row.
- Identity cell: name in mono 13px/600 ellipsis (masked unless the user reveals it), secondary line 12px tertiary.
- Body cells: `repeat(auto-fill, minmax(min(100%, 170px), 1fr))`, gap `10px 22px`. Each cell has label 12.5px secondary, value 650 tabular, a 4px meter track (`color-mix` 10% of text) with a fill in success/medium/failure by threshold, and a 11.5px reset line (stale uses warning text). Unknown values render a hatched track rather than an empty one. Absent windows show an explicit placeholder.
- Action cell: ghost icon-plus-label button, 30px high, right aligned.

### Summary card
- `grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr))`, gap 10px.
- Card: radius 12, padding `13px 15px 12px`, 1px border, background `color-mix(in srgb, var(--bg-primary) 82%, transparent)`.
- Content: head (14px/600 name, 12px tertiary count at right), 12.5px secondary label, headline number 26px/650 tabular, 12.5px tertiary capacity, then a segmented bar and a coverage or reset line (11.5-12px).

### Form section (Config `SectionCard` plus `Field`)
- Section: `section > header (optional index badge, icon badge, h2 title, description) + content`. Radius 14, 1px border, the same 82% surface. Fields in `FieldGrid` (two columns, `wide` spans both), toggles in `ToggleRow` (title plus description plus switch), grouped sets in `FieldGroup`.
- Fields use the shared `Input` and `Select`: label above, hint below, invalid state with `role="alert"` text. A dirty form shows the `FloatingSaveBar` plus `useUnsavedChangesGuard`. Placeholders that are technical examples (URLs, header names) may stay untranslated.

### States
- Loading: skeleton placeholders sized like the real content (Quota uses 6 cards at 168px, radius 14). No spinner for list loads. The refresh control spins in place.
- Empty: `EmptyState` with a title, a one-line description and at most one recovery action. Distinguish first-run (no data), filtered-empty (clear the search or tab) and disabled (not connected).
- Error: an inline `ErrorBanner` (`role="alert"`, 12.5px, `--danger-color` on `--bg-error-light`, `--warning-border`, radius `md`, wraps long text) above the content, with a retry. Per-row errors appear in the row's body text. Toasts are for transient action results only, with errors persisting longer than successes.
- Partial: the stale or unknown value is shown explicitly (hatched meter, "unknown" text), never as a blank.

## 4. Top 3 changes

1. **Shared page primitives** (findings 1, 3, 9, 10). Create `components/ui/PageHeader`, `MetaLine`, `SearchField`, `ErrorBanner` and `Pagination`. Give `Button` a `shape="pill"` and make the ink pill the primary. Add `Select variant="quiet"`. Sketch:
   ```tsx
   <PageHeader title={t('x.title')}
     meta={[{ text, tone: 'muted'|'ok'|'attention' }]}
     actions={<><Button shape="pill" variant="secondary" aria-pressed>…</Button>
                <Button shape="pill" loading={refreshing}>…</Button></>} />
   ```
   Migrate Quota, Vault and Config first (mostly deletions), then Logs, Plugins, Plugin Store, OAuth, System and Providers. This removes about 6 pill copies and 13 keyframes, and gives every page one header.

2. **Token and contrast pass** (findings 2, 7, 8, 18, 22). In `themes.scss` add `--success-text`, `--warning-text`, `--danger-text`, a darker light `--text-tertiary`, and `--focus-ring`. Make `--warning-color` amber. Add `--radius-sm/md/lg/xl` and a type scale in `:root`. Add a global `:focus-visible` rule and one reduced-motion block. Migrate Quota's literals as the reference, and leave other pages to follow as they are touched. Verify with the same contrast script in both light themes.

3. **Dialog and feedback hardening** (findings 4, 5, 6, 11, 12, 13, 14). Extract `useDialog` from Modal and Sheet. Rework the Modal animation to the shared tokens with reduced-motion handling. Fix `Input` aria-describedby ordering. Make `ConfirmationModal` show errors and focus Cancel on danger. Make error toasts persist about 8s with a warning icon. Add arrow-key handling to the header menus and a focus ring on `ToggleSwitch`.

## 5. Quick wins (each under 30 minutes)

- Set `fallbackLng: 'en'` in `i18n/index.ts:23`.
- Default `Button` to `type="button"` (`Button.tsx:35`).
- Fix `Input` spread order and add `role="alert"` to its error (`Input.tsx:42-59`).
- Add `:focus-visible` to `ToggleSwitch` (`ToggleSwitch.module.scss`).
- Replace `'Back'` and `'Loading...'` in `SecondaryScreenShell` with `t('common.back')` and `t('common.loading')`.
- Use `IconAlertTriangle` for error toasts and raise the error duration (`NotificationContainer.tsx:21`, `constants.ts:48`).
- Remove the dead `notification entering` classes on the two menu popovers (`MainLayout.tsx:1041,1081`).
- Persist `sidebarCollapsed` in localStorage (`MainLayout.tsx:329`).
- Add an inline theme script to `index.html` to prevent the light flash.
- Add `aria-label` to the global refresh and logout buttons (`MainLayout.tsx:1019,1134`).
- Remove the hardcoded `#fff` in the dark `.btn` override and use `var(--primary-contrast)`.
- Replace Sheet's `z-index: 2000` and `100vw !important` with the token and `min(width, 100vw)` (`Sheet.module.scss:10,174`).
- Add the missing confirm-title keys (`auth_files.delete_title` and the six siblings) to all five locales.
- Add a script that fails CI when locale key sets diverge from `en.json`.
