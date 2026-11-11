# UX audit: AI Providers page

Audited 2026-10-07 against the Quota Management page as the quality bar. Audit only; no source changes. Findings come from reading the code and `en.json`, not from running the app.

Files read: `src/features/providers/ProvidersWorkbenchPage.tsx`, `src/features/providers/components/*`, `src/features/providers/sheets/*` (provider form, sponsor form, key and model editors, connectivity test hook, detail view), `src/components/providers/ProviderStatusBar.tsx`, `src/components/ui/Sheet` and `Collapsible`, and the quota page files. `src/components/modelAlias` is only used by Auth Files. Only `ExcludedModelsPicker` from `excludedModels` appears on this page. Aliases here are the "Custom models" rows in the provider form.

## 1. Summary

The page is a left rail of provider families (12 entries), a header card with a title and three count chips, and a per-provider table in the main area. Rows open a right-hand sheet that is either a read-only detail view or a long edit form. The structure is sound: the sheet guards unsaved changes, the selected row stays highlighted, sort and filter choices persist per provider, and there is a unified create/edit flow.

The daily-use experience falls short of the quota page in four ways:
- Rows are tall and carry little decision-relevant data. They stack a badge, success/failure pills and a status bar in one 174px cell. Priority and weight, which drive routing, are not shown at all.
- The detail view shows only counts, so you must open Edit to see models, aliases, exclusions or headers.
- Connectivity testing exists only inside the edit form. It has no history, no timing and no accessible result text.
- Empty, error and loading states are thin. A search that matches nothing shows "No resources yet, click New", and there is no retry or error-state recovery.

The form is one long scroll. Its most common field (models/aliases) is collapsed, rarely used advanced groups sit above it, and errors appear at the very bottom, away from the footer.

## 2. Findings

Ordered by impact on a daily user.

| # | Sev | Finding | File:line | Recommendation |
|---|---|---|---|---|
| 1 | High | Rows are tall and not scannable. The status cell stacks the Active badge, "Success: n / Failure: n" pills and a status bar in a 174px column. Priority, weight and the key's health are not visible, even though "Sort by priority" exists. Success and failure are shown with the same weight as identity. | `ProviderResourceTable.tsx:235-262, 46`; `ProviderResourceTable.module.scss:119-176` | Rebuild rows like the QuotaLedger. Left: name or masked key (mono), with base URL on a second line. Middle: a compact health cell (status dot, `n ok / m fail`, thin status bar on one line). Right: priority and weight chips, then actions. Drop the "Prefix" column and show the prefix as a small chip under the URL only when set. |
| 2 | High | Detail view is nearly empty and forces Edit. Non-sponsor detail shows identifier, URLs, prefix and counts only. It does not show models, aliases, excluded rules, headers, priority, weight or disabled state. | `ResourceDetailView.tsx:366-448` | Make the detail view the real inspect view. Add the model list (name → alias), excluded rules as chips, headers (values masked), priority, weight and cooldown/retry policy. Include a mask/reveal toggle with copy for the key, as the quota page does. |
| 3 | High | Connectivity test is buried and gives thin feedback. It exists only in the edit form, under the "Test model" select. There is no row-level test. The result is an unlabeled icon plus a "Reachable" hint for single-key brands only. There is no latency, model used, HTTP status or timestamp. "Test all" fires all keys at once with `Promise.all`, and every probe is a real completion request. | `BaseProviderForm.tsx:662-713`; `ApiKeyEntriesEditor.tsx:211-223`; `useConnectivityTest.ts:~286-290, 250, 349, 439, 524`; `ConnectivityStatusIcon.tsx:1-28` | Add a "Test" icon button to each row and a "Test all" action in the panel header. Show the result inline as text: "OK 412 ms · gpt-4o-mini · just now", or the error text. Keep the last result in session state. Run test-all with concurrency of about 3. Give the icon `role="img"` with an aria-label, and put the message in an `aria-live="polite"` region. Add a hint that the probe sends a small real request. |
| 4 | High | A search or filter that matches nothing is reported as an empty provider. The empty state always says "No resources yet, click New" and offers New, whether the list is empty, the search found nothing, or the model filter hid everything. | `ProviderResourcePanel.tsx:188-209`; `en.json providersPage.table.empty` | Three states, as in `QuotaPage.tsx:450-475`. (a) The provider has no entries: "No Codex keys yet" with an "Add key" button. (b) Search or model filter hides all rows: "No matching entries" with a "Clear search/filters" button. (c) Load failed: see #5. |
| 5 | High | Error and loading handling is weak. On a failed load the page shows the header and a plain `error-box` with no `role="alert"` and no retry button (refresh is only in the header). All mutations are silently disabled while a background fetch runs, with no explanation. The skeleton (120px plus two 420px blocks) does not match the rail-and-table layout. | `ProvidersWorkbenchPage.tsx:129-133, 287-289, 375-406` | Use an error banner with `role="alert"` and a Retry button, as on the quota page. Show a "Refreshing…" inline indicator instead of silently disabling the edit, delete and toggle buttons. Make the skeleton mirror rail plus table rows. |
| 6 | High | Form errors are only shown at the very bottom of a long scroll, away from the fixed footer. The form uses `noValidate`, validation runs only on submit, and there are no field-level messages, `aria-invalid` or focus move. A user pressing Create with the error scrolled out of view sees nothing happen. | `BaseProviderForm.tsx:413-426, 502, 1008`; `SponsorProviderForm.tsx:896` | Put the error banner at the top of the sheet body, or just above the footer. Move focus to the first invalid field and set `aria-invalid` and `aria-describedby`. Mark required fields with an asterisk or "Required" tag. |
| 7 | Med | Form hierarchy puts the wrong things first. Order is base fields, then "Provider-specific behavior", then "Advanced runtime policy", then Key entries, Headers, Custom models, Excluded models, then Fingerprint and Cloak. The model list is the most-edited section but is collapsed by default, below two advanced groups. Fingerprint sits loose outside any group, after the collapsibles. | `BaseProviderForm.tsx:747-758, 860-864, 909, 928-954` | Reorder to Connection (name, key, URL), Routing (priority, weight, prefix, disabled), Models and aliases (open by default when the list is non-empty), then an "Advanced" group containing proxy, headers, excluded, behavior, runtime policy, fingerprint and cloak. Add count hints to every collapsed header ("Excluded · 3 rules", "Headers · 2"). Excluded and Headers currently show no hint, so hidden config is invisible. |
| 8 | Med | Model aliases are hard to find. The section is called "Custom models", and the alias lives in a second unlabeled column (placeholder only: "Alias (optional)"). Users looking for "model alias" will not find it. | `BaseProviderForm.tsx:860-864`; `ModelEntriesEditor.tsx:68-92`; `en.json form.modelsSection` | Rename to "Models and aliases". Add a column header row ("Upstream model" / "Alias exposed to clients"). Keep the aria-labels. |
| 9 | Med | Priority and weight are confusing and inconsistently placed. Priority renders only when `supportsPrefix` is true, beside Prefix. Weight is a separate full-width field below. Priority has no hint at all (does higher or lower win?). Weight's hint reads "≤ 0 is excluded". | `BaseProviderForm.tsx:603-660`; `en.json form.priority, form.weightHint` | Put Priority and Weight together in a "Routing" row with a one-line explanation each. Gate priority on its own capability flag. Show them in the table (see #1). |
| 10 | Med | The "view" action uses an eye icon, which means "reveal secret" in the form and on the quota page. Here it opens a detail sheet. Rows are not clickable. | `ProviderResourceTable.tsx:287-298, 222-224` | Make the whole row open the detail view (keyboard-accessible on the name button). Reserve the eye for reveal/mask. Keep Edit and Delete as icon buttons. |
| 11 | Med | Under 1280px the 12-item provider rail stacks above the table and pushes the content far down the page. The rail also duplicates numbers: the subtitle shows "a/b active" and the badge shows the total again. | `ProvidersWorkbenchPage.module.scss:19`; `ProviderCategoryList.tsx:335-352` | Below 1280px, render the families as a horizontal scrolling tab row with counts, like `ProviderTabs` on the quota page. In the rail, drop the redundant badge and add a small attention dot when a family has disabled or failing entries. |
| 12 | Med | The header card spends its space on low-value chips: "provider families" and "Updated <time>". It shows no health signal. The primary action is a generic "New", detached from the selected provider. | `ProviderHeaderCard.tsx:232-247, 218-227`; `ProvidersWorkbenchPage.tsx:408-424` | Use the QuotaHeader pattern: title plus a mono meta line ("▍ 14 entries · 12 active · 2 need attention"). Drop the "families" chip. Label the primary button "Add Codex key" (provider-aware). Move "Updated" into the refresh tooltip. |
| 13 | Med | The panel search field has no aria-label and no clear button, and the sort bar sits on a separate second row. The quota page has a labeled search with a clear button and compact sort/view selects on one line. | `ProviderResourcePanel.tsx:160-170, 172-184`; `ProviderResourceToolbar.tsx:75-101` | Match `QuotaPage.tsx:383-418`: labeled search with a clear X on the left, then sort and model-filter controls aligned right on the same row. Drop the visible "Sort by" label and keep the aria-label. |
| 14 | Med | The model filter popover is not keyboard-friendly. It has no `aria-expanded` or `aria-haspopup`, no Escape to close, and no focus management. It also has no search box, so it is unusable with hundreds of models. The label "All models" does not say it filters entries. | `ProviderResourceToolbar.tsx:103-151` | Add the ARIA attributes, Escape handling and a text filter at the top of the list. Label it "Models: all" and show a count badge when a filter is active, plus a clear affordance. |
| 15 | Med | Edit mode hides the existing key. There is no way to view or copy the saved key. The form's eye toggle only reveals text you just typed. The quota page offers masked-with-reveal. The code comment shows hiding it in the form is deliberate (autofill concerns). | `BaseProviderForm.tsx:166-170, 543-560`; `ResourceDetailView.tsx:347, 418` | Keep the form field blank for the autofill reason. Add masked-with-reveal and copy to the detail view, where autofill is not a risk. |
| 16 | Med | Promotional and affiliate content competes with the core view. The panel header carries an emphasised "Register" link, and Kimi adds a promo paragraph. A separate "Quick Fill" rail group sits beside real providers. | `ProviderResourcePanel.tsx:136-157`; `ProviderCategoryList.tsx:365-370` | Demote registration links to the empty state or a small "Get a key" text link in the overflow area. Remove the Kimi promo paragraph from the header. Give the Quick Fill group a clearer name ("Preconfigured providers") or keep it collapsed. |
| 17 | Med | Stale route text in the sheet. The description reads "Manage resources under /ai-providers/openai" (and similar), but `/ai-providers/*` redirects to `/ai-providers`. The eyebrow and title also repeat the same word ("New" and "New · Codex"). | `ProviderSheet.tsx:99-108, 233-254`; `router/MainRoutes.tsx:25` | Replace the description with something useful ("Credentials for Codex. Changes apply immediately."), or drop it. Show the eyebrow or the verb in the title, not both. |
| 18 | Med | Cloak mode is a free-text input with a placeholder ("auto / always / never"). Typos are possible. | `BaseProviderForm.tsx:960-967` | Use a `Select` with the three values plus "Default". |
| 19 | Low | Detail footer uses "Cancel" on a read-only view. | `ProviderSheet.tsx:178-184` | Label it "Close". |
| 20 | Low | Remove buttons on header rows and on API key entry cards have no accessible name. Header inputs rely on placeholders only. API key entry labels are not tied to inputs (`label` without `htmlFor`). Key removal has no confirmation. | `BaseProviderForm.tsx:806-845`; `ApiKeyEntriesEditor.tsx:282-289, 298, 337, 347` | Add aria-labels ("Remove header", "Remove key #n"), `htmlFor` ids and a visible "Name / Value" header row. Make removal undoable until Save, or confirm it when the key is already saved. |
| 21 | Low | The status bar's tooltips respond to pointer events only, so keyboard and screen-reader users get no per-block data. | `components/providers/ProviderStatusBar.tsx:75-95` | Make the blocks focusable and add an aria-label per block, or expose the same summary through the row's health text (#1, #3). |
| 22 | Low | Hard-coded English strings in a localized app: "auth: …" in the table, header placeholders ("X-Custom-Header", "value") and the cloak placeholder. | `ProviderResourceTable.tsx:183`; `BaseProviderForm.tsx:808, 820, 965` | Move to i18n keys. |
| 23 | Low | Toasts are generic ("Created", "Enabled", "Deleted") and do not name the entry. After a toggle in a long list there is nothing to say which row changed. | `ProvidersWorkbenchPage.tsx:329, 349, 365, 370` | Include the entry name or masked key: "Disabled sk-…a1b2". |
| 24 | Low | The table has a hard minimum width of 960px (fixed columns 180+220+72+138+174+176). Narrow screens scroll horizontally behind a sticky actions column. | `ProviderResourceTable.tsx:46`; `ProviderResourceTable.module.scss:4-6` | Below about 900px, render each row as a stacked card (name, URL, health, actions), as the quota page does for its card view. |
| 25 | Low | The toggle's aria-label describes the action ("Disable"), not the state. The status badge and the toggle show the same fact twice. | `ProviderResourceTable.tsx:146-157, 273-286` | Keep the toggle as the only control and let the row's dim state or a "Disabled" tag carry the status. |
| 26 | Low | The form has no per-field indication of what "Disable this entry" means for in-flight traffic, and save is disabled until dirty with no hint. | `ProviderSheet.tsx:72, 214-219` | Add a title on the disabled submit ("No changes to save"). |

Findings count: 26.

## 3. Top 3 changes

### A. Rebuild the entry list as a dense ledger with live health

Replace the six-column table with one dense row per entry, grouped under the selected provider, in the QuotaLedger style:
- Left: name or masked key in mono, with the base URL and prefix chip on a second line. The whole row opens the detail view.
- Middle: one compact health cell on a single line (green/amber/red dot, `n ok / m fail`, a thin 24h status bar) plus priority and weight chips.
- Right: enable toggle, Test, Edit and Delete icon buttons. The eye icon is reserved for reveal.
- The page header becomes the QuotaHeader pattern: title plus a mono meta line ("▍ 14 entries · 12 active · 2 need attention") and a provider-aware primary button ("Add Codex key"). Search with a clear button, sort and the model filter sit on one row below it.
- Under 900px, rows collapse to stacked cards. Under 1280px, the rail becomes a horizontal tab row with counts.
- Covers findings 1, 10, 11, 12, 13, 24, 25.

### B. First-class test flow with inline results

- Add a Test button to every row and a "Test all" action in the panel header. Concurrency is capped at about 3.
- Results render as text in the row's health cell: "OK 412 ms · model · just now" or the error message. They are kept in session state, announced through an `aria-live` region, and shown with a labeled icon.
- The edit form keeps its Test button but moves it up beside the key and URL fields instead of under "Test model", with the same result line.
- A small hint explains that a test sends one real, tiny request.
- Covers finding 3, and 21 through the shared health text.

### C. Reorganize the sheet: real detail view, grouped form, errors up top

- Detail view: show everything a user wants to inspect: model → alias list, excluded-rule chips, headers (values masked), priority, weight and policy. Key is masked with reveal and copy.
- Form: group into Connection, Routing (priority and weight together, with one-line explanations), "Models and aliases" (open when non-empty, with column headers), and one collapsed "Advanced" group (proxy, headers, excluded, behavior, runtime policy, fingerprint, cloak). Every collapsed header shows a count or state hint.
- Put the error banner at the top, mark required fields, set `aria-invalid`, and move focus to the first invalid field on submit.
- Fix sheet copy: "Close" instead of "Cancel" in detail mode, and drop the stale route description.
- Covers findings 2, 6, 7, 8, 9, 15, 17, 18, 19.

## 4. Quick wins (under 30 minutes each)

- Rename "Custom models" to "Models and aliases" in `en.json` (`form.modelsSection`). Add a header row above the model inputs.
- Add an aria-label to the panel search input and a clear button (copy `QuotaPage.tsx:383-408`).
- Split the empty state: "No matching entries" with "Clear search" when a search or filter is active, and keep "New" only for a truly empty provider.
- Change "Cancel" to "Close" in the detail footer (`ProviderSheet.tsx:183`).
- Replace the stale route text in the sheet description, or remove it.
- Convert the cloak mode input to a `Select`.
- Add aria-labels to the header and API-key remove buttons; add `htmlFor` ids on key-entry labels.
- Add count hints to the Excluded models and Headers collapsibles.
- Add `role="alert"` to the page error banner and a Retry button.
- Add `role="img"` and an aria-label to `ConnectivityStatusIcon`, and show the error message text next to it.
- Add `aria-expanded`, `aria-haspopup` and Escape-to-close to the model filter popover.
- Move the hard-coded strings ("auth:", "X-Custom-Header", "value", cloak placeholder) into i18n.
- Put the entry name in the created, updated, deleted and toggle toasts.
- Change the header primary button label from "New" to a provider-aware "Add <provider> key".
