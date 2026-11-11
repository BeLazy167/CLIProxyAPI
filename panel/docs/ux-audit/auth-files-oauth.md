# UX audit: Auth Files and OAuth Login

Audited 2026-10-07 against the Quota Management page as the quality bar. Audit only; no source changes. Findings come from the code, not visual inspection.

## 1. Summary

The Auth Files page is a card grid. Each card holds a provider badge, email, filename, status warning, cooldown disclosure, request counts and status bar, a meta row, an optional inline quota block, and an action footer. Above the grid sit a header, a decorative spectrum bar, provider tabs, and a toolbar. Two config panels (excluded models and model alias) sit below the grid. It is functional and has real safety work in it: confirmations on delete, single-flight guards, an unsaved-changes guard on the edit pages, and an explicit cooldown model. But it ignores the quota page's patterns. It has no grouping, no email masking, and about 200px per credential, so a fleet of 30 or more needs many screens or pages. Delete controls sit beside the filters. The OAuth page is a long vertical stack of full-width cards. The flow state is mostly one status badge plus toasts, with inconsistent cancel and retry support across providers and no link back to the credentials it creates.

## 2. Findings (ordered by daily impact)

| # | Sev | Finding | Location | Recommendation |
|---|---|---|---|---|
| 1 | High | Cards are about 200px tall with 340px minimum width. Quota mode forces the wide layout, and compact mode is a hidden setting. Scanning 30+ credentials needs pagination (page-size input in a popover). The quota page does this in one dense row per account. | `AuthFilesPage.module.scss:35-56`, `AuthFilesPage.tsx:636`, `AuthFileCard.tsx:133-335` | Make a grouped ledger row the default view. Keep cards as an optional toggle. Reuse `QuotaLedger` row and meter cells. |
| 2 | High | Raw emails appear as the primary label, title tooltip, and in the Details view, with no mask or "Show emails" toggle. The quota page masks by default. The same credential is masked on one page and exposed on the other, and screenshots leak. | `AuthFileCard.tsx:156-161`, `identity.ts:55-62`, vs `quota/maskIdentity.ts`, `QuotaHeader.tsx:72` | Apply `displayNameTransform` to primary and secondary text. Share one persisted `showEmails` preference between the two pages. Add the toggle to the Auth Files toolbar. |
| 3 | High | No grouping by provider. A flat grid is filtered by tabs, so "All" mixes providers, and the pagination breaks grouping. The quota page groups with counts. | `AuthFilesPage.tsx:671`, `ProviderTabs.tsx` | With "All", render provider group headers with counts and a problem badge. Use a collapsible group per provider and drop pagination. Keep tabs as a jump or filter. |
| 4 | High | "Delete All / Delete Problem / Delete <Type> / Delete filtered" is a red button at the right end of the filter toolbar, next to sort and display options. Its label changes with the filter. The confirm text never says how many files or which ones. The all-files case uses `deleteAll()`, not the filtered list. One misclick plus Confirm wipes credentials, and they can't be re-created without a new login. | `AuthFilesToolbar.tsx:376-384`, `useAuthFilesData.ts:354-381`, en.json `delete_all_confirm` | Move it into an overflow menu or the batch bar. The confirm dialog should show the exact count, the first 5 masked names, and a typed or checkbox confirmation for more than 5 files. Pass count and type into the message. |
| 5 | High | Single delete confirm reads `Are you sure you want to delete file "<name>" ?` with generic title and the generic "Confirm" label. It shows the filename (which embeds the unmasked email) but no provider, no state, and no consequence (needs re-login). Batch delete shows only a count. Batch disable and enable have no confirmation. | `useAuthFilesData.ts:324-330`, `909-911`, en.json `delete_confirm`, `batch_delete_confirm` | Use confirm text "Delete" (danger variant). Message: provider, masked identity, "This credential must be re-added via OAuth or upload." Add a confirm for batch disable. Offer a "Download backup" button in the dialog. |
| 6 | Med | Four icon-only buttons per card (refresh, download, details, delete) at 30px. Only `title` tooltips label them. "Auth File Details / Edit" sits behind a gear icon. The danger button is adjacent to the safe ones. Touch targets are below 44px. | `AuthFileCard.tsx:267-317`, `AuthFileCard.module.scss:418-433` | Keep the primary actions (Models, Refresh) visible and move Download, Details, Delete into a "..." menu with text labels. Make Details open on row click. Add `aria-label`, not just `title`. |
| 7 | Med | Status is spread over four signals: provider tab counts, the header meta line, the pulse bar (aria-hidden, no legend), and per-card warning text. The pulse bar encodes live/idle/warning/problem with no key. A "problem" is `unavailable`, error status, or a warning, and it excludes disabled files, so counts can disagree with what the user sees. | `VaultPulse.tsx`, `VaultHeader.tsx:57-69`, `constants.ts:145-149` | Replace the pulse bar with summary cards like the quota page (Total, Active, Problem, Cooling down, Disabled), clickable as filters. Drop or label the bar. |
| 8 | Med | Quota appears only on cards when a single provider tab is selected (and not in compact mode). On "All" there is no quota, even though Auth Files and Quota show the same credentials. The idle state is a text button, "Click to load". The user has to switch pages to compare. | `AuthFileCard.tsx:97-98`, `AuthFileQuotaSection.tsx:335-343` | Show a one-line compact meter (worst window percent plus reset time) in every row from the shared quota store, with a "load" affordance in the group header. Link "Open in Quota". |
| 9 | Med | Display settings are hidden in a popover that holds page size and compact mode. Page size is a free number input that commits on blur. Sort offers only Default / A-Z / Priority, with no sort by status, last used, or quota. | `AuthFilesToolbar.tsx:330-374`, `AuthFilesPage.tsx:390-397` | Replace with a segmented view toggle (Rows / Cards) and drop page size once rows are grouped. Add sort options: Problems first, Most used, Lowest quota. |
| 10 | Med | Cooldown disclosure packs scope, time, reason, HTTP status, backoff level, deadline, observed time, a disclaimer paragraph, and a reset button into a `<details>`. The summary reads clearly, but the body is dense. The disclaimer appears on every card. | `AuthFileCooldownSection.tsx:70-143`, en.json `cooldown_note` | In rows, show a single amber chip, e.g. "Cooling 12m (429)". Put the details and the disclaimer in a popover or the Details sheet, shown once. |
| 11 | Med | Both config panels (excluded models and model alias) sit under the grid and are usually below the fold. Add buttons are labelled "Add" with no context. The panels' Delete buttons are red and adjacent to Edit. Excluded entries show only a model count. | `AuthFilesPage.tsx:729-757`, `OAuthExcludedCard.tsx`, `OAuthModelAliasCard.tsx` | Move them to a tabbed "Routing rules" section or a header menu. Show the first few excluded model names in each row and label the add buttons. |
| 12 | Med | OAuth page: the "waiting" state is a status badge reading "Waiting for authentication..." with no elapsed time, no expiry hint (Devin's hint says five minutes only in the hint copy), and only Devin has a Cancel. A user who closes the tab, or loses the popup, has no way to abort Codex, Claude, Antigravity, xAI or Kimi. The Login button just shows a spinner. | `OAuthPage.tsx:435-471`, `708-720`, `835-843` | Add Cancel and Retry for every provider. Show a countdown from start. Show "Waiting for you to authorize in the browser (2:41 left)". |
| 13 | Med | The callback paste field appears for five providers once a URL exists, labelled "Callback URL" with a long hint about remote browser mode. For most users on localhost the field is irrelevant but always shown, and the flow's three steps (open link, authorize, paste if needed) aren't numbered. xAI also accepts a bare code. | `OAuthPage.tsx:776-834`, en.json `oauth_callback_hint`, `devin_callback_hint` | Number the steps. Collapse the callback field under "Browser can't reach this server? Paste the callback URL". Auto-expand it after N seconds of waiting. |
| 14 | Med | The OAuth page is a vertical stack of eight or more full-width cards, with Kimi "featured" (blue gradient, sign-up affiliate button) above the others. It is a long scroll for a task that needs one click. A heading-less first section and a "Other login methods" heading for Vertex only. | `OAuthPage.tsx:864-973`, `OAuthPage.module.scss:41-51`, `61+` | Use a compact grid or list of provider rows: icon, name, a one-line hint, connected count, Login. Expand in place. Demote the Kimi sign-up to a link. |
| 15 | Low | After success the card resets to idle after 5 seconds (`SUCCESS_RESET_DELAY_MS`), including the "View auth files" button, so a user who looks away loses the confirmation. The success message doesn't name the account that was created. | `OAuthPage.tsx:141`, `375-394`, `844-850` | Keep the success state until dismissed. Show the new credential's masked identity and a "View it" link that opens `/auth-files?search=<name>`. |
| 16 | Med | The model alias edit page silently drops rows with an empty name or alias on save, and shows an error only for duplicate aliases. A user who half-fills a row sees "saved", but the row is gone. | `AuthFilesOAuthModelAliasEditPage.tsx:344-350` | Validate on save: flag incomplete rows inline and block save, or show "N incomplete rows ignored". |
| 17 | Low | Both edit pages bind Escape on `window` to go back. This fires while focused in a select or input and only the unsaved guard prevents data loss. Step labels "01" and "02" are decorative. The provider is a free-text-capable picker, and the title reads "Add" until the provider is typed. | `AuthFilesOAuthExcludedEditPage.tsx:140-148`, `OAuthEditorProviderCard.tsx:33-36` | Ignore Escape when the event target is an input, select or open popover. Drop or explain the step numbers. |
| 18 | Low | Error and empty states are uneven. A list failure shows a plain red banner above the grid while the grid keeps rendering. The config panels' load error is the generic "Refresh failed" with no detail or cause. The loading state is `EmptyState title="Loading"` in the panels, but skeleton cards on the grid. | `AuthFilesPage.tsx:629-633`, `OAuthExcludedCard.tsx:34-42` | Use the quota page's error block (message, Retry, last-success time). Use skeleton rows for loading in the panels. |
| 19 | Low | Responsiveness: `.oauthGrid` has a 400px minimum column. The toolbar wraps at 900px with search taking the full row, but tabs, segmented filter, sort, display, and delete all compete for the second line. The batch bar is fixed-position, wraps at its 9 buttons, and can cover the last cards. | `OAuthPage.module.scss:185`, `AuthFilesToolbar.module.scss:255-264`, `BatchActionBar.tsx:490-545` | Reduce the batch bar to count, Enable, Disable, Download, "..." (Select page, Select filtered, Invert, Delete). Reduce toolbar controls to search plus one filter menu on mobile. |
| 20 | Low | Copy: "Auth Files Management", "Virtual auth file", "Auth File Details / Edit", "Refresh OAuth credential", "Refresh all credentials" (the last one refreshes server-side tokens, not the list, which the confirm text spells out in a long paragraph). The header has both "Refresh all credentials" and "Refresh" side by side. | en.json `auth_files.*`, `VaultHeader.tsx:73-94` | Rename: "Refresh tokens" (header button) vs "Reload". Use "Details" for the gear, "Runtime-only" for virtual. Shorten the confirm text to two sentences. |

Findings count: 20 (5 High, 9 Med, 6 Low).

## 3. Top 3 changes

**1. Grouped credential ledger shared with Quota**
```
Auth Files            42 credentials · 38 active · 3 problem · 2 cooling     [Show emails] [Refresh tokens] [Upload]
[ search ........ ] [All|Enabled|Disabled|Problem] [Sort: Problems first v] [Rows|Cards]
 CLAUDE  (12)  2 problem                                                   [Load quota]
 [ ] o  jo•••@e•••.com   claude-jo...json   5h ███░░ 62%  7d █░░░ 21%   ok 1.2k fail 3   [on]  [Models] [...]
 [ ] !  ma•••@g•••.com   cooling 12m (429)   5h █████ 98%                                    [on]  [Models] [...]
 CODEX   (8)
 ...
```
The row cells are the same components as `QuotaLedger`. Quota shows on "All" too. The "..." menu holds Details, Download, Refresh token, and Delete. Cards stay as an optional view. The header gets the same "Show emails" toggle as the quota page, sharing one persisted preference.

**2. Safe destructive actions**
- Delete dialog:
  ```
  Delete 14 Claude credentials?
  ma•••@g•••.com, jo•••@e•••.com, +12 more
  These must be re-added via OAuth or upload.
  [Download backup]        [Cancel] [Delete 14]
  ```
  More than 5 files adds a checkbox or typed `DELETE`.
- Bulk delete moves out of the filter toolbar into the "..." menu and the batch bar.
- Batch disable confirms, with the count.
- Delete gets an Undo path or a "Download backup first" offer.

**3. OAuth page as a provider list with an active-login panel**
```
Connect an account
 [icon] Claude    Browser sign-in           Connected: 3     [Login]
 [icon] Codex     Browser sign-in           Connected: 5     [Login]
 [icon] Devin     Device flow, 5 min        Connected: 1     [Login]
   v Codex login in progress
     1. Open the link      [Copy] [Open]   code: ABCD-1234
     2. Authorize in the browser
     3. Browser can't reach this server?  [paste callback URL ......] [Submit]
     Waiting... 2:41 left                  [Cancel]
   Success: connected jo•••@e•••.com       [View in Auth Files] [Login another]
```
Every provider gets Cancel and Retry. The success state stays until dismissed. "Connected: N" links to `/auth-files?type=x`. Kimi sign-up becomes a small link, not a featured hero.

## 4. Quick wins (each under 30 minutes)

- Mask emails on the card using `displayNameTransform` and a local "Show emails" toggle (finding 2, first step).
- Include count and provider in the delete-confirm messages, and change `confirmText` from "Confirm" to "Delete".
- Add a confirm to batch disable.
- Add `aria-label` next to every icon button `title` on the card.
- Move the toolbar delete button after a divider (or into the batch bar) and add a visible spacing gap from sort and display.
- Ignore Escape in the edit pages when focus is in a form control.
- Flag incomplete alias rows on save instead of dropping them silently.
- Show the new credential's name in the OAuth success message and extend the 5s reset to a manual dismiss.
- Add a legend (tooltip) for the pulse bar, or hide it.
- Rename "Refresh all credentials" to "Refresh tokens" and shorten the confirm copy.
- Make the "waiting" badge show elapsed time on the OAuth page.
- Make the config panels' error state show the error message and Retry.

## Source files read

`src/features/authFiles/` (page, card, toolbar, batch bar, cooldown, quota section, header, pulse, tabs, data hook), `src/pages/OAuthPage.tsx`, `src/pages/oauthAttempts.ts`, both edit pages, and the en.json keys for `auth_files` and `auth_login`.
