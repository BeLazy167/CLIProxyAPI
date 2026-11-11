# UX audit: Logs Viewer (#/logs)

Scope: `src/features/logs/` (LogsPage.tsx 1085 lines, LogsPage.module.scss, hooks, model) and `src/pages/LogsPage.tsx` (re-export only). Quality bar: Quota Management page. Read-only audit; no source was changed.

Line references below are to `src/features/logs/LogsPage.tsx` unless a path is given.

## 1. Summary

The page is functionally rich and the data layer is careful (cursor reads, buffer eviction, scroll anchoring, request guards). The UI on top of it is a generic log tail, not a tool for finding a failing request. Everything that narrows the list to failures (status groups, method, path) is inside a modal behind a "Filters & display" button, mixed with display switches. Filter state is persisted in localStorage but only partly shown. Live tail is off by default and its state is a small dot in a footer at the bottom of the card. Rows are a flat run of badges in an order that changes with what each line contains, with no columns, so status, path and latency do not line up from row to row. There is no summary of what is in the buffer (how many 5xx, how many errors), where the Quota page opens with a meta line and pool cards. Error request log files live on a second tab that is a plain filename list with Open and Download buttons. Disconnected and fetch-error states are weak or misleading.

## 2. Findings

Ordered by impact on a daily user.

| # | Sev | Finding | Where | Recommendation |
|---|-----|---------|-------|----------------|
| 1 | High | Finding a failing request takes 4 clicks: open the "Filters & display" modal, pick 4xx or 5xx chips, close the modal, then scroll. The level select only matches exact levels, and levels are inferred from the word "error" anywhere in the raw text, so false positives occur. There is no one-click "errors only". | 539-560, 596-616; model/logParsing.ts:81-90 | Add an inline quick-filter segment next to search: `All / Errors (n) / 4xx (n) / 5xx (n)`, where Errors = level error/fatal OR status >= 400. Keep the modal only for method and path. Restrict level inference to the bracketed level token plus status code, not free text. |
| 2 | High | Active filter state is hidden. The toggle badge counts only method, status and path. It ignores level, search text and the "hide management logs" switch, which defaults to on and is persisted silently. After a reload a user can be looking at a filtered list with no visible sign. The empty state "No matching logs found" does not say which filters caused it. | 245-246, 553-557; 33-36; 921-925; hooks/useLogFilters.ts:32-40 | Render an active-filter chip row under the toolbar (each chip removable, plus "Clear all"). Include level, management-hidden and search. Make the empty state list the active filters and offer "Clear filters". |
| 3 | High | Live tail is off by default (`useLocalStorage('logsPage.autoRefresh', false)`), so a first visit shows a stale snapshot. The control is an unlabeled timer icon in a 5-icon toolbar; its state ("Reading paused") appears only in the footer. The green dot depends only on the toggle, so it stays green while polls are failing. | hooks/useLogStream.ts:73; 700-711; 448-468; LogsPage.module.scss:322 | Replace the timer icon with a labelled Live/Paused pill at the top of the card (green "Live", amber "Paused", red "Retrying in 16s"). Default to live when the tab is active. Drive the dot from request health, not only from the toggle. |
| 4 | High | Disconnected state is missing. `loading` starts true and `loadLogs` is only called when connected, so a disconnected user sees "Loading logs..." indefinitely; after a disconnect with an empty buffer the page can fall through to "No Logs Available / enable logging to file", which is wrong. Controls are disabled with no explanation. | hooks/useLogStream.ts:70, 243-248, 91-95; 755-757, 939-941 | Add an explicit disconnected EmptyState ("Not connected", with a reconnect/login action) checked before loading and empty. Use `Skeleton` rows (as Quota does) for loading instead of a hint line. |
| 5 | High | Fetch errors give no recovery path. The error box has no Retry button and no indication of the next automatic retry (8s doubling to 60s), and it sits above the toolbar so it pushes the viewer down when it appears. Rotation and eviction notices cannot be dismissed. | 443-447, 476-487; hooks/useLogStream.ts:147-149 | One banner with message, "Retry now" and "Retrying in Ns". Make rotation/eviction notices dismissible and transient. Reserve space so the viewer does not jump. |
| 6 | High | Row anatomy is not scannable. Badge order is level, source, request id, status, latency, ip, method, path, message, and each is conditional, so columns shift between rows. Status comes before method and path and nothing aligns. Every INFO line carries a blue badge, which is noise that hides the lines that matter. The source (`gin_logger.go:94`) repeats on every request line. | 824-913; LogsPage.module.scss:409-520 | Use a fixed grid for parsed request lines: `time | status | method | path (flex) | latency | request id`. Move source and IP to a tooltip or detail line. Drop the badge for INFO and DEBUG (dim text instead); keep colored badges for WARN/ERROR/FATAL. Tint the row text for 5xx. |
| 7 | Med | The timestamp column is a fixed 160px and prints the full date on every row. This costs width on the dense lines the user scans most and pushes path/message right, which forces horizontal scroll because wrap is off by default. | 824; LogsPage.module.scss:412 | Show `HH:mm:ss` (about 84px). Put the full timestamp in the title attribute and add day separator rows. |
| 8 | Med | No summary of the buffer. The Quota page leads with a meta line and pool cards; here the only counts are in an 11px footer ("Searching loaded logs only: N lines cached, M matched") and the load-more banner ("Loaded / Filtered / Hidden"). A user cannot tell at a glance whether anything is failing right now. | 469-474, 784-794; features/quota/components/QuotaHeader.tsx | Add a compact meta line like Quota's: `10,000 lines . 312 requests . 14 errors . 3 x 5xx`, each count clickable to apply the matching quick filter (ties to #1). Simplify load-more wording to "Showing last 100 of 842 matches". |
| 9 | Med | The request id is an outlined chip that opens a modal with the request log. Good idea, but the id cannot be copied, searched, or used as a filter by clicking; the chip does one thing and looks like a tag. The 404 message is two long sentences in a red box. | 851-866, 141-167; i18n logs.request_log_missing | Click = filter to that request id (all its lines). Add a small "open log" icon beside it for the existing viewer, and a copy action. Shorten the 404 message to one line with a tooltip for detail. |
| 10 | Med | Error request log discovery is thin. A separate tab with a description, a refresh button, and rows of filename plus size/date and Open/Download. No search, sort, count, size or time columns, and no hints parsed from the filename. Loading and empty are plain hint text. The "request logging is enabled" warning and the "list is empty" hint can show together and read as contradictory. Download has no per-row busy state. | 946-1021, 976-980, 965-971, 987-989 | Mirror the Quota ledger: header with count and total size, search box, newest-first sort, columns `modified / request id / size / actions`. Use Skeleton for loading. Show one explanatory state at a time. Add a per-row loading state on Download. |
| 11 | Med | Structured filters live in a modal that covers the log while you filter, and the modal mixes filters (method, status, path) with display options (wrap, hide management, raw). Seven method chips and up to 12 path chips is a lot for a modal, and nothing is visible updating behind it. | 562-686; hooks/useLogFilters.ts:6 | Use an anchored popover or inline row so results update live. Split into "Filters" (method, path) and a small "View" menu (wrap, raw, hide management). Offer paths as a searchable list rather than a chip cloud. |
| 12 | Med | Search lacks feedback and shortcuts. No match highlight in rows, no match count beside the input, no `/` or Ctrl+F focus shortcut, no field syntax (`status:500`, `id:ab12cd34`, `path:/v1/`). It is a case-insensitive substring over the raw line. Typing a term resets the window to the last 100 matches, so the count of matches is not obvious. | 499-523, 280-290; model/logSelectors.ts:99-115 | Highlight matches in the row. Show "42 matches" inside the input. Bind `/` to focus search and `Esc` to clear. Optionally parse `status:`, `id:`, `path:` tokens. |
| 13 | Med | The toolbar is five unlabeled icon buttons (refresh, timer, download, trash, fullscreen) at the same weight; the destructive Clear sits beside Fullscreen with an 8px gap. "Download cached logs" exports `logBuffer.buffer`, the full unfiltered buffer including management traffic, while the user sees a filtered view. | 688-751, 112-116 | Group as: Live pill, Refresh (meaningful when paused), a "More" menu for Download (offer "visible" vs "all cached") and Clear (separated, danger-styled), Fullscreen on its own. Add shortcuts to tooltips. |
| 14 | Med | Follow behavior is mostly right but the indicator is weak. "Back to latest . New lines: 0" shows whenever the user has scrolled up, even with zero new lines, and when polling is paused it implies lines will arrive. There is no pause-while-selecting and no keyboard shortcut to jump to latest. The button floats at `bottom: 48px` of the card, which depends on the footer height. | 488-497; LogsPage.module.scss:338-346; hooks/useLogScroller.ts:140-160 | Show "N new" only when N > 0, else "Jump to latest". Add `End` to resume. Stop following while text is selected. Anchor the button to the viewer area instead of the card. |
| 15 | Med | Narrow widths. Wrap is off by default, so rows keep the 160px time column and nowrap badges and need horizontal scrolling on phones; the row grid only collapses to one column when `.wrapped` is set. The search uses `calc(100% - 200px)`, which does not track the real toolbar width. Between 769 and 1100px the filter label is hidden and search shrinks to 120px. | LogsPage.module.scss:608-666, 374-394, 636-638 | Default wrap on at 768px and below. Stack time above content on mobile regardless of wrap. Put search on its own row and controls on a second row below about 900px. |
| 16 | Low | The tab bar uses `aria-pressed` buttons rather than tab semantics, and switching tabs unmounts the log card, losing scroll position. The tab is not in the URL. The label "Log Content" does not say what it is beside "Error Request Logs". | 369-424, 428, 946 | Use `role="tablist"`/`tab` or the shared tabs component Quota uses; keep the log card mounted (hidden) to preserve scroll; add `?tab=errors` to the hash route. Rename to "Live logs" and "Request error logs". |
| 17 | Low | Double-click copies the line, which also fires on normal word selection. Every row has a `title` tooltip ("Double-click to copy") that pops over content as you move the mouse down the list. The per-row copy icon is hover/focus-within only, but rows are not focusable, so keyboard users cannot reach copy. | 817-823, 904-913; LogsPage.module.scss:589-599 | Remove double-click copy and the row title. Make rows `tabIndex=0` with a `c` shortcut, or expose "copy visible lines" in the toolbar. Show the copy icon always on touch devices. |
| 18 | Low | The footer `role="status"` includes `lastUpdated` as a clock time, so screen readers can re-announce on each 8s poll. Severity relies on color plus a 2px left border for lines without a level badge. | 448-468, 826-843 | Announce only state changes (live, paused, error), not the clock. Add visually hidden severity text to tinted rows. |
| 19 | Low | Control sizing diverges from the rest of the app. Logs overrides shared Input/Select/Button to a 40px height with custom borders (`--log-control-height`), while Quota uses compact `size="sm"` controls. The 28px page title plus tab pill replaces Quota's title plus meta line. | LogsPage.module.scss:3-9, 117-131, 21-28 | Use shared `size="sm"` controls and drop the local overrides so the toolbar matches Quota and gets shorter. |
| 20 | Low | Dead i18n keys: `logs.buffer_evicted`, `filter_panel_expand`, `filter_panel_collapse`, `auto_refresh`, `load_more_hint`, `clear_confirm` are not referenced. `buffer_evicted` describes real behavior (old lines dropped at 10,000 lines or 8 MiB) that is never shown to the user. | i18n/locales/en.json:936-1010; model/logBuffer.ts:3-5 | Surface eviction as a footer note when `logBuffer.evicted > 0`; remove the unused keys across locales. |

## 3. Top 3 changes

### A. Failure-first quick filters and visible filter state (findings 1, 2, 11)

```
Logs Viewer                                    [ Live ]   Refresh  More v  Full
10,000 lines . 312 requests . 14 errors . 3 x 5xx
[ search (/) ............... 42 matches ]  [ All | Errors 14 | 4xx 11 | 5xx 3 ]  [Filters v] [View v]
Active: [ POST x ] [ /v1/chat/completions x ] [ hide /v0/management x ]      Clear all
---------------------------------------------------------------------------------------
12:04:11  502  POST  /v1/chat/completions                 1.2s   a1b2c3d4
12:04:09  200  POST  /v1/chat/completions                 640ms  e5f6a7b8
```

The quick-filter segment sets level and status in one click. Method and path move to an anchored popover; wrap, raw and hide-management move to a View menu. Every active constraint is a removable chip, and the empty state names them.

### B. Scannable request rows plus a live-state pill (findings 3, 6, 7, 8)

```
TIME      LVL    ST   METHOD  PATH                               LAT     REQ ID
12:04:11  ERROR  502  POST    /v1/chat/completions               1.2s    a1b2c3d4  [copy]
12:04:09         200  POST    /v1/chat/completions               640ms   e5f6a7b8
12:04:08  WARN        token refresh failed for ...
```

Fixed grid for request lines; free-text application lines span the remaining columns. INFO and DEBUG show no badge. 4xx amber, 5xx red with a tinted row, left border retained. The date moves to day separator rows. The Live/Paused/Retrying pill replaces the timer icon and the footer status, and defaults to Live while the tab is active.

### C. Error request log ledger and real error states (findings 4, 5, 10, 16)

```
[ Live logs ] [ Request error logs (23) ]
23 files . 1.8 MB . newest 2026-10-07 12:04          [ search ....... ]  Refresh
  MODIFIED          REQUEST ID   SIZE     FILE
  2026-10-07 12:04  a1b2c3d4     14 KB    error-v1-chat-...log        [Open] [Download]
  2026-10-07 11:58  9f8e7d6c     6 KB     error-v1-responses-...log   [Open] [Download]
```

Same dense row style as the Quota ledger, Skeleton while loading, and one explanatory state at a time (request logging on, empty, error with Retry, disconnected with Reconnect). Add the same disconnected and retry banners to the live tab.

## 4. Quick wins (each under 30 minutes)

- Hide the count in "Back to latest" when it is 0 (line 495) and show "Jump to latest".
- Change the `autoRefresh` default to `true` (hooks/useLogStream.ts:73); stored values are unaffected.
- Remove the per-row `title` and the double-click copy handler (lines 817-823).
- Show `HH:mm:ss` only, full timestamp in `title` (line 824; width 160px to about 84px at scss:412).
- Do not render a level badge for info, debug and trace (lines 826-843).
- Add `/` to focus search and `Esc` to clear it; add `End` to resume following.
- Include the level filter and the search term in the active-count badge (lines 245-246, 553-557).
- Name the active filters in the empty-state description (lines 921-925).
- Add a Retry button to the error box (lines 443-447).
- Default wrap on when `window.innerWidth <= 768`.
- Make the footer `role="status"` announce only state changes (line 452).
- Remove the six unused i18n keys; show a footer note when `logBuffer.evicted > 0`.
- Make "Download cached logs" respect the current filter, or label it "all cached lines" (line 114).
- Rename the tabs to "Live logs" and "Request error logs".
