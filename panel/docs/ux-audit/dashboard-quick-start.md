# UX audit: Dashboard and Quick Start

Audited 2026-10-07 against the Quota Management page as the quality bar. Audit only; no source changes.

## 1. Summary

The Dashboard (`src/features/dashboard/DashboardPage.tsx`) is built like a marketing page. It opens with an 80px computed verdict headline ("Minor turbulence."), a glass hero card, a pulse-line animation and 44–76px section gaps. Daily-use data starts well below the fold. The data is sound and the theme tokens are used correctly, but the hierarchy is inverted compared to the Quota page. The Quota page puts a compact header with a meta line first and dense rows next. The Dashboard puts slogans first and actionable facts (which credential is unavailable, which provider is failing) are never named.

Loading and error states are essentially absent. A failed auth-files fetch looks identical to "no credentials". Quick Start is not a quick start. `/quick-start` renders `ProvidersWorkbenchPage fixedBrand="apikeyFun"`, which shows a one-vendor APIKEY.FUN config form (899 lines of form code with grouped keys, protocol model settings and URL modes). Its empty state is one sentence and two competing buttons. There are no steps, no verification and no endpoint to copy.

## 2. Findings (ordered by impact on a daily user)

| # | Sev | Finding | Location | Recommendation |
|---|---|---|---|---|
| 1 | High | No loading or error state on the Dashboard. `loadAuthFiles` swallows errors and sets `null`. The credentials tile then shows "—" and "No credential files found", the same as a genuinely empty install. A models failure also becomes "—" with no message. There is no skeleton, although Quick Start has one. | `hooks/useDashboardOverview.ts:132-140, 273-283`; `DashboardPage.tsx:129-135, 415` | Track `loading` and `error` per source. Show skeleton tiles on first load. On failure show an inline error row ("Could not load auth files. Retry") in that panel, in the style of the quota page's explicit error state. Keep "No credential files" only for a successful empty result. |
| 2 | High | The hero consumes roughly 500–600px before any data. Title is `clamp(44px, 6.2vw, 80px)`, bottom padding up to 120px, page gap up to 76px, plus a decorative pulse line and ambient grid. The four KPI tiles and the credential/provider data are pushed down. | `DashboardPage.tsx:232-311`; `dashboard.module.scss:11, 69-84, 108-116` | Replace with a `QuotaHeader`-style header. The h1 is "Dashboard". Below it is a mono meta line: `v1.2.3 · Connected · 3 attention`. On the right are a Refresh pill and one primary action. Put the requests figure and success rate in the KPI row. Drop the pulse line, or shrink it to a sparkline inside the Requests tile. |
| 3 | High | The Dashboard never says what needs attention. The verdict ("Needs attention.") does not name the failing provider or the unavailable credentials. The only detail is a separate bar and legend further down. The quota header already has an `attentionCount` pattern. | `DashboardPage.tsx:86-102, 419-461`; `QuotaHeader.tsx:55-66` | Add an attention strip under the header. Examples: "2 credentials unavailable → Auth Files", "Codex success 62% → Logs", "Not connected". Each item is a link, and the strip is hidden when empty. |
| 4 | High | Quick Start has no guided flow. Empty state is "No configuration yet." with a plain "New" button and an amber "Register now" button. The amber is the app's warning color, so the affiliate CTA reads as an alert. A user who has never used APIKEY.FUN gets no sequence: get key, paste key, verify, point a client at the proxy. Clicking "New" is also an extra step before the form appears. | `SponsorQuickStartPanel.tsx:80-117, 119-122`; `SponsorQuickStartPanel.module.scss:99-185`; `en.json providersPage.sponsor.emptyRegisterHint` | Make it a numbered checklist with live status per step (see Top 3 #2). Show the form directly when empty. Use a neutral or primary treatment for "Get a key" and label it as an external link. |
| 5 | Med | The Dashboard does not route a new user. With zero providers and zero auth files, the primary hero button is still "Manage providers", and Quick Start is not mentioned anywhere on the page. | `DashboardPage.tsx:247-249, 185-222` | If `providerKeys === 0 && credentials.total === 0`, replace the attention strip with a first-run card ("Add your first provider → Quick Start / AI Providers / Auth Files"). |
| 6 | Med | Quick Start gives no persistent proof that setup worked. Save shows only a toast. "Check usage" is manual and its result lives inside a collapsed grouped-key block. The header card hides its summary and "Updated" chips for this variant. | `SponsorQuickStartPanel.tsx:56-62`; `SponsorProviderForm.tsx:318-355, 548-611`; `ProvidersWorkbenchPage.tsx:419` | After a successful save, run the usage check automatically. Show a status badge at the top of the panel ("Key valid · 12.4 USD remaining" or "Key rejected"). Keep the toast as secondary. |
| 7 | Med | Quick Start edit mode carries advanced configuration: grouped keys, protocol model allowlists and aliases, URL modes and region routes. All of it sits in the primary view. | `SponsorProviderForm.tsx:869+`; `en.json sponsor.groupedKeysHint, modelsHint, urlOptionDescriptions` | Show key, region/URL and usage check by default. Put grouped keys and model settings under an "Advanced" disclosure, closed by default. |
| 8 | Med | The same title appears twice on Quick Start: an h1 "APIKEY.FUN" in the header card and an h2 "APIKEY.FUN" in the panel, plus the logo. The h1 changes from "Quick Start" to the vendor name once configured, and the sidebar label does the same. | `ProvidersWorkbenchPage.tsx:281-286`; `SponsorQuickStartPanel.tsx:87, 130`; `MainLayout.tsx:587-592` | Keep h1 "Quick Start" with the vendor as a subtitle or meta line. Remove the duplicate h2, or reduce it to the logo plus a status badge. Keep the nav label stable. |
| 9 | Med | The throughput chart is hover and click only. Columns are `div`s with `onMouseEnter`/`onClick` and no `tabIndex` or key handling. The description says "Hover a column", which is wrong on touch. The accessible table exists but is collapsed. | `ThroughputChart.tsx:503-509`; `en.json dashboard.traffic_description` | Make columns focusable (roving tabindex with arrow keys) or expose the table by default at narrow widths. Reword to "Hover or tap a column." Add a peak and last-bucket readout line under the chart so no hover is needed for the key numbers. |
| 10 | Med | The verdict flips on tiny samples. `toneForSuccessRate` uses fixed 95/80 thresholds with no minimum volume. A window with 2 requests and 1 failure shows "Needs attention." in red. | `utils.ts:345-350`; `DashboardPage.tsx:92-102` | Require a minimum sample (for example 20 requests) before tone is `warning` or `critical`. Below that use a neutral "Low volume" state and show the sample size beside the rate. |
| 11 | Med | Overlapping nouns and duplicated data. "Credentials" (auth files), "Provider keys" and "Management keys" are three different counts with similar names. The Credentials tile and the Credential status panel show the same totals. The tile lumps disabled and unavailable together as "not serving" while the panel splits them. Server version appears in the hero meta and again in the Runtime panel. | `DashboardPage.tsx:126-157, 160-173, 419-461` | Rename to "Auth files", "Provider API keys" and "Dashboard access keys". Drop the separate Credential status panel, or fold its segmented bar into the Auth files tile. Remove the version row from Runtime, or from the meta line. |
| 12 | Med | Provider fleet rows are display-only. There is no link to the provider, no failure count (percent only), no sort, no search. Rank numbers ("01") mean traffic order and nothing else. Quota rows by comparison have summary cards and per-credential detail. | `DashboardPage.tsx:366-402`; `dashboard.module.scss:565-581` | Make each row a link to AI Providers or Quota for that provider. Show `ok / failed` counts, with failed in the red token when above 0. Add a small sort toggle (traffic or success rate). Drop the rank column. |
| 13 | Med | Contrast risk from `--text-quaternary` on text. It is used for fleet rank numbers, the idle meter fill and the offline period glyph. Light theme value is `#c0bab3` on a light surface, which is very likely below 4.5:1. Dark `#6f6962` needs checking. Disabled health segments use the same token with no text label on the bar itself. | `dashboard.module.scss:586-589`; `themes.scss:20, 109, 180`; `Meter.tsx:12-17` | Verify with a contrast checker. Use `--text-tertiary` for any text that carries information. Reserve quaternary for decorative rules only. |
| 14 | Low | The bottom "Where to go from here" grid (six cards) duplicates the sidebar and the hero buttons. It is the last thing on the page, so almost nobody reaches it. | `DashboardPage.tsx:185-222, 520-538` | Remove it, or replace it with the contextual first-run and attention items from #3 and #5. |
| 15 | Low | Each section stacks an eyebrow, a large title and a description. That costs about 100px of header per section. Titles are decorative: "Throughput, ten minutes at a time", "Every provider, side by side", "Configuration at a glance". | `DashboardPage.tsx:342-349, 357-361`; `en.json dashboard.*_title` | Use short noun titles ("Traffic", "Providers", "Runtime") and one compact line of help text. Drop the eyebrows. |
| 16 | Low | A "Live" badge and a breathing status dot are shown whenever the socket is connected. There is no last-updated time, and refresh lives only in the global header. | `DashboardPage.tsx:262-267, 104-105` | Show "Updated 12:03:41" in the meta line. Show "Live" only if polling is confirmed active, otherwise show the timestamp alone. |
| 17 | Low | Mobile layout. At 460px and below, the four KPI tiles stack to one column of about 140px each, roughly 560px of scroll. Fleet rows at 760px and below wrap the rate to its own row and leave loose gaps. The hero figure sits at 42px+. | `dashboard.module.scss:383-389, 577-593` | Keep KPI tiles at two columns down to 360px with a smaller value size. Collapse fleet rows to a two-line layout: name and rate on line one, counts and sparkline on line two. |
| 18 | Low | Heavy motion for an admin screen: count-up on the headline number, staggered reveal groups, scroll-reveal on async sections, a breathing period, a pinging dot. Reduced-motion is handled, but async panels revealed on scroll can appear blank briefly. | `DashboardPage.tsx:48-56`; `dashboard.module.scss:125-132, 294-304` | Remove the reveal on async sections. Keep the count-up only on first load. |

Findings count: 18.

## 3. Top 3 changes

**1. Replace the hero with a compact, attention-first header and a single KPI row.**
- Layout: one header row matching `QuotaHeader`. The h1 "Dashboard" is on the left with a mono meta line `v1.2.3 · Connected · Updated 12:03`. A Refresh pill and a "Manage providers" action are on the right.
- Below it, an attention strip lists linked problems, for example "2 credentials unavailable" and "Codex 62% success". It is hidden when there are none, and becomes the first-run card when nothing is configured.
- Next comes one KPI row of four tiles: Requests (with the success/failure split bar and a tiny sparkline), Success rate (with sample size), Auth files (with the active/unavailable/disabled segmented bar folded in), and Provider API keys. Tiles use the existing `--viz-*` and amber tokens.
- Chart, provider list and runtime follow. Net effect: the first screen shows real state without scrolling. This covers findings 2, 3, 5, 10, 11 and 14.

**2. Turn Quick Start into a guided four-step setup with live status.**
- Layout: h1 "Quick Start" with a one-line description, then a vertical checklist card. Each step has a status mark (not started, done, failed).
- Step 1 "Get a key" has a neutral outbound link, labeled as external. Step 2 "Add your key" shows the key field masked with the existing reveal toggle, plus a region selector with the recommended one preselected.
- Step 3 "Verify" runs automatically on save and shows "Valid · 12.4 USD remaining" or the specific rejection. Step 4 "Connect a client" shows the proxy base URL with a copy button.
- Grouped keys and model settings sit under a closed "Advanced" section. After setup the page collapses to a compact status card with Edit. This covers findings 4, 6, 7 and 8.

**3. Add real loading, error and keyboard states across the Dashboard.**
- Skeleton tiles on first load. Per-panel inline error rows with Retry, styled like the quota page's explicit error state. A distinct "Disconnected" state that does not render zeros as data.
- Provider rows become links with failed counts and a sort toggle. Chart columns become keyboard-focusable, with a peak/last-bucket readout so hover is not required. Informational text uses `--text-tertiary` or stronger. This covers findings 1, 9, 12, 13 and 16.

## 4. Quick wins (under 30 minutes each)

- Change the `traffic_description` copy from "Hover a column" to "Hover or tap a column" (`en.json`).
- Recolor the "Register now" button from amber to a neutral or primary style (`SponsorQuickStartPanel.module.scss:169-185`).
- Remove the duplicate h2 "APIKEY.FUN" in the Quick Start panel (`SponsorQuickStartPanel.tsx:130`).
- Show the Quick Start form immediately when empty, removing the extra "New" click (`SponsorQuickStartPanel.tsx:80-117`).
- Swap `--text-quaternary` for `--text-tertiary` on `.fleetRank` (`dashboard.module.scss:586-589`).
- Add a minimum-sample guard in `toneForSuccessRate` callers so a 2-request window does not show red (`DashboardPage.tsx:92`).
- Split `stat_credentials_hint` into "{{active}} active · {{unavailable}} unavailable · {{disabled}} disabled".
- Delete the version row from the Runtime panel (`DashboardPage.tsx:167`).
- Reduce `.page` gap from `clamp(44px, 6.5vh, 76px)` to about 32px and hero bottom padding to about 48px (`dashboard.module.scss:11, 78`).
- Add `tabIndex={0}`, `role="button"` and an Enter/Space handler to chart columns as a stopgap (`ThroughputChart.tsx:503-509`).

## Relevant files

- `src/features/dashboard/DashboardPage.tsx`
- `src/features/dashboard/dashboard.module.scss`
- `src/features/dashboard/hooks/useDashboardOverview.ts`
- `src/features/dashboard/components/ThroughputChart.tsx`
- `src/features/providers/ProvidersWorkbenchPage.tsx`
- `src/features/providers/components/SponsorQuickStartPanel.tsx`
- `src/features/providers/sheets/forms/SponsorProviderForm.tsx`
