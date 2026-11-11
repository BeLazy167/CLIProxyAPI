# UX audit: Config Panel (#/config)

Scope: `src/features/config/` plus the shared pieces it uses (`components/ui/Input`, `Collapsible`, `ToggleSwitch`, `Select`). Reference bar: the Quota Management page. Code read only; the page was not run in a browser, so spacing and contrast comments are inferred from the SCSS.

## 1. Summary

The Config Panel is already a solid base. It has eight underline tabs (Common plus seven numbered sections), a combobox search over about 100 settings with YAML-key aliases, error badges and amber dirty dots on tabs, a floating save bar, and a two-step save (read latest server YAML, show a diff, confirm, then patch field by field with recovery if the patch half-applies). The save model is safe and well thought out. The weak points are about helping a daily user understand and navigate the settings, not about safety plumbing. Help text is often missing or restates the label ("Select credential selection strategy", Session Affinity TTL with no hint). Related settings are not grouped (Network is about 19 controls in two flat grids, with cooldown settings scattered across both). Dependent settings stay editable when they have no effect. Dangerous toggles (Allow Remote Access, Disable Cooling, Disable request cloaking) look identical to harmless ones. Restart-required notes only appear in a toast after saving. Navigation chrome (search, tabs) scrolls away, and the save bar does not say what changed. Compared with the Quota page, the panel is airy: every boolean is a 74px bordered row, and there is no summary strip, no "what changed" view, and no skeleton while loading.

## 2. Findings

Ordered by impact on a daily user. Line numbers are from the current tree.

| # | Sev | Finding | File:line | Recommendation |
|---|-----|---------|-----------|----------------|
| 1 | High | Help text is missing or useless on the settings people most often have to reason about. Routing Strategy hint reads "Select credential selection strategy"; Round Robin, Weighted Round Robin and Fill First are not explained anywhere. Session Affinity Routing has no description, Session Affinity TTL has no hint or unit. Max Retry Credentials, Disable Cooling, Persist cooldown status, Transient error cooldown, and the "Disable image generation" values (`false`/`true`/`chat`/`passthrough`) all rely on the user knowing the YAML docs. | `SectionNetwork.tsx:122-158`, `:192-200`, `:275-282`; `en.json` `routing_strategy_hint` (line 1387), `session_affinity_ttl` (1391) | Give every select option a one-line description shown under the control for the selected value (e.g. "Fill First: use one credential until it is exhausted, then move to the next"). Write a real hint for every field in plain words, with unit and default ("seconds, default 60"). Add a test that fails when a field has no hint key, so gaps cannot reappear. |
| 2 | High | Network tab is a flat wall: about 19 controls in two unlabeled `FieldGrid`s, inputs and toggles mixed, with the cooldown family (Disable Cooling, Persist cooldown status, Transient error cooldown, Max retry interval) split between the two grids. Nothing says what is common and what is rare. | `SectionNetwork.tsx:71-292` | Split into titled groups using the existing `FieldGroup`: Proxy, Retries, Routing and session affinity, Cooldowns, Images and video. Put rarely changed ones (video cache TTL, WS auth, gpt-image base model) in a collapsed "More" group. Connectivity needs the same: Trusted proxies and Auth dir sit beside Host/Port with no heading. |
| 3 | High | Dangerous settings carry no visual weight or confirmation. Allow Remote Access, Management Key, Disable Cooling, Disable request cloaking and Trusted proxies look like any other row. Remote access can be turned on with no management key set and no warning. The Management Key field is a plain password input with no reveal and no note that remote access needs it. | `SectionConnectivity.tsx:134-200` (toggle `:141-147`, key `:172-181`); `SectionNetwork.tsx:266-274` | Add a `danger` variant of `ToggleRow` (amber left border plus a short consequence line). When Allow Remote is on and the key is empty, show an inline warning on the key field and count it as a warning on the tab. Confirm via the existing `showConfirmation` only when turning Allow Remote on. Add show/hide to the key input. Verify against the backend whether remote access without a key is actually accepted before wording the warning. |
| 4 | High | Restart-required is only reported after saving, as a toast, and only for commercial mode and trusted proxies. The Commercial Mode description ("Disable high-overhead middleware...") says nothing about a restart, although the code comment says it takes effect on restart. A user cannot tell before saving which changes need a restart, and the toast disappears. | `useConfigDocument.ts:262-267`; `SectionLogging.tsx:35-44`; `en.json` `commercial_mode_desc` | Add a "Restart required" pill beside the label of any field that needs one (data-driven flag in the search index or constants). After a save that touched such a field, keep a persistent amber notice at the top of the page until reload, not just a toast. |
| 5 | High | Navigation chrome is not sticky. On long tabs (Advanced, Payload, Connectivity with expanded groups) search and tabs scroll out of view, so switching sections means scrolling back up. There is no in-tab index either. | `ConfigPage.tsx:322-358`; `ConfigPage.module.scss:20-35` | Make toolbar and tabs one sticky bar below the app header (`top: var(--header-height)`), with a bottom border and page background. Quota's compact header with search and small controls is the model. |
| 6 | High | Validation errors are inline and counted on tabs, but Save is simply disabled with "Fix validation errors before saving" and no way to find the error. Errors inside collapsed groups (Discovery, TLS, Advanced groups, Codex relay fields) are invisible: only Payload auto-opens on error. | `ConfigPage.tsx:258-268`; `uiState.ts:149-155`; `SectionPayload.tsx:65,80,96,112,129` (the only `defaultOpen={hasErrors}` use); `SectionDiscovery.tsx:22-25`; `SectionAdvanced.tsx:69-71,132,202,236` | Make the "Fix errors" status in the save bar a button that jumps to the first invalid field (reuse `useFieldJump`, which already opens the enclosing `<details>`). Make `Collapsible` open itself and show an error dot in its summary when any child has an error. |
| 7 | High | The save bar and header say "Unsaved changes" / "N unsaved" but not what changed. The only review is the YAML diff modal, which is accurate but low level for a flipped toggle. Per-field dirty state is not shown on the field, only as an amber dot on the tab. | `FloatingSaveBar.tsx:143-167`; `uiState.ts:200-257`; `DiffModal.tsx`; `Field.module.scss` (no dirty style) | Show "3 unsaved: Network 2, Logging 1" in the bar with a Review action that lists changed fields by label (old to new) above the YAML diff. Add an amber left rule on dirty fields and a per-field reset icon. Keep the diff modal as the final step. |
| 8 | Med | Dependent settings stay editable when they have no effect. Examples: Subagent session affinity and Session Affinity TTL when Session Affinity is off (the hint admits "only effective when session affinity is enabled"); Strict Bypass Signature Validation when the signature cache is on; Codex bootstrap timeout when buffering is off. | `SectionNetwork.tsx:192-216`, `:275-282`; `SectionAdvanced.tsx:166-198`; `en.json` `antigravity_signature_strict_desc`, `codexStreamBootstrapTimeout.hint` | Disable (not hide) dependents and append "Requires X" to the hint when the parent is off. Where a dependent belongs to a toggle, indent it under the parent row. |
| 9 | Med | Search finds the setting but tells little. Results show label and section only: no current value, no YAML key, no hint snippet; no clear button; no shortcut to focus. Because `hintKey` text is searchable, a result can appear for reasons the user cannot see. | `ConfigSearch.tsx:139-166`; `searchIndex.ts` | Show the current value (or On/Off) right-aligned in each result, the YAML key in mono under the label, and highlight the matched term. Add a clear (x) button and `/` to focus. |
| 10 | Med | The Common tab duplicates fields that live in other sections. Search always jumps to the canonical section, so the user leaves Common, and the dirty dot lights on two tabs for one change. | `constants.ts:57-66`; `useFieldJump.ts:34-38`; `SectionCommon.tsx` | Keep it, but turn it into an "Overview": current values as compact summary cards (host:port, proxy on/off, key count, routing strategy, log mode, quota fallbacks) with edit-in-place for the 8 fields. This matches Quota's summary cards and gives the tab a reason to exist. |
| 11 | Med | The API key list is the highest-stakes block but thin. Delete is immediate (staged until save, but no confirm or undo). Copy shows "Link copied to clipboard". The label reads "Client API Keys (access.api-keys)" and the hint says "consistent with 'API Key Management' page style" (developer-facing copy). Names are saved to browser storage immediately while keys wait for Save, explained only in a modal hint. | `ApiKeysCardEditor.tsx:136-142`, `:150-156`, `:189-196`, `:203`; `en.json` `visual.api_keys.hint`, `name_hint` | Use a dedicated "API key copied" string. Show a removed-row with Undo until save, or confirm delete. Replace label and hint with user language ("Keys clients use to call this proxy"). Show a key count in the header of the block. |
| 12 | Med | Loading and disconnected states look like real data. While the config loads, or when disconnected, sections render default values with disabled inputs, so a user sees blank or zero fields. There is no skeleton, and the load-failed box has no Retry button (Reload is in the header). | `ConfigPage.tsx:270-273`, `:309-318`; `uiState.ts:116-150` | Render the shared `Skeleton` layout while `doc.loading`, and put a Retry button inside the error box. Disconnected should show an `EmptyState` with an action instead of disabled forms. |
| 13 | Med | Number fields give no unit, range or "unset" meaning in the control. What empty, 0 or negative mean is spread across hints ("Leave empty to keep it unset. Set to 0 or a negative..."; "0 uses the default 60 seconds; a negative value disables"). Placeholders double as defaults but vanish when typing. | `SectionNetwork.tsx:73-121`, `:226-236`; `SectionStreaming.tsx:67-89`; `SectionLogging.tsx:52-82` | Add a unit suffix (s, MB, files) and a "default: N" chip that doubles as a reset button. Extend the existing "Disabled" pill pattern from Streaming to retry interval, cooldown and log size limit so the interpreted state shows next to the input. |
| 14 | Med | Toggle rows are tall and sparse. Each boolean is a 74px minimum bordered card, so Network (8 toggles) and Advanced (15 or more) run long compared with Quota's dense rows. On mobile the switch drops below the text, making rows taller still. | `Field.module.scss:93-113` (`min-height: 74px`, mobile single column) | Add a compact density: single-line title, 12px description under it, switch right-aligned (also on mobile), `min-height: 52px`. |
| 15 | Med | Settings people do change (model-level cooldown, cloaking, Codex bootstrap buffering) sit in collapsed groups with only a one-line summary, and OAuth behavior is nested inside Advanced. Collapsed groups show no count of dirty or enabled fields. | `SectionAdvanced.tsx:63-70,132,202,236`; `SectionOAuthBehavior.tsx:22-26`; `Collapsible.tsx:42-48` | Add a badge slot to the `Collapsible` summary ("3 changed", "2 on", error dot). Open groups automatically when dirty. Consider promoting OAuth provider behavior to its own section. |
| 16 | Med | Implementation vocabulary leaks into labels and hints: "Redis Usage Queue Retention" with "RESP LPOP/RPOP" in the hint; "WebSocket Authentication ... (oauth.providers.aistudio.ws-auth)"; "Pass Through Upstream Headers". Title Case and sentence case are mixed. | `en.json` around lines 1330-1410 (`sections.system`, `sections.network`) | One copy pass: sentence case, plain verbs, YAML key shown in a separate mono line (not in the label), one sentence of purpose per field. |
| 17 | Med | The Quota Fallback tab holds three toggles, one with no description (Use Antigravity Credits), and two of them are duplicated on Common. It is the thinnest tab but costs a slot in an eight-tab bar. | `SectionQuota.tsx:16-35`; `en.json` `quota.antigravity_credits` | Fold the three toggles into Network under a "When quota runs out" group, or keep the tab and add the missing description plus a link to the Quota page. |
| 18 | Low | Header meta permanently shows "N settings", the least useful number on the page. Quota's meta line shows state that changes (loaded, attention). | `uiState.ts:201-208`; `ConfigHeader.tsx:43-60` | Show "In sync", "3 unsaved", "1 error" and the last-loaded time. Move the count into the search placeholder ("Search 112 settings"). |
| 19 | Low | Inconsistent field components. Streaming uses raw `<input class="input">` inside `FieldShell` (errors above hints) while `Input` renders hint above error. The API key label is a raw `<label>` with inline styles and modal inputs are raw `.input`. Error boxes have no `role="alert"`. | `SectionStreaming.tsx:67-89,124-146`; `FieldPrimitives.tsx` (`FieldShell`); `Input.tsx:47-58`; `ApiKeysCardEditor.tsx:150-156,228-255` | Use `Input` everywhere with a `suffix` prop for the Disabled pill, fix hint/error order in one place, add `role="alert"` or `aria-live="polite"` to field errors. |
| 20 | Low | Toggle accessibility. `ToggleRow` labels the switch with `aria-label` but the description is not linked via `aria-describedby`, and only the small switch is clickable, not the row. Tab focus ring uses `outline-offset: -2px` and may clip. | `FieldPrimitives.tsx` (`ToggleRow`); `ConfigTabs.module.scss:50-56` | Make the whole row a `<label>` or forward clicks to the switch, add `aria-describedby`, check the tab focus ring against the bar background. |
| 21 | Low | Keyboard support is partial. Tabs have arrows/Home/End and search has arrows/Enter/Escape, but there is no Ctrl/Cmd+S for the save review and no shortcut to focus search. | `ConfigPage.tsx` (no key handler); `ConfigSearch.tsx:90-124` | Add Ctrl/Cmd+S to open the review when dirty and valid, and `/` to focus search. |
| 22 | Low | `ConfigHeader` has an `extraActions` slot documented as the mobile home for the mode switch, but the page never passes it, so on narrow screens the mode switch wraps under search. | `ConfigHeader.tsx:13-14,32-38`; `ConfigPage.tsx:322-335` | Wire it for `isMobile` (already computed in the page) or delete the dead prop and comment. |
| 23 | Low | The Proxy URL field carries a sponsor link row, and `SponsorHintSpacer` is injected into neighbouring fields on Common and Network just to keep inputs aligned. It adds invisible rows, hidden only on mobile. | `sharedFields.tsx:65-95`; `SectionNetwork.tsx:76,89`; `SectionCommon.tsx:48,55` | Move the sponsor line below the input as a hint so no spacer is needed, or into the section header. |
| 24 | Low | The save bar status is mono 12px text whose wording changes by state, with no icon or tone marker beyond text color. On short viewports the fixed 720px bar covers the last field row (padding mitigates this). | `FloatingSaveBar.tsx:143-167`; `FloatingSaveBar.module.scss:6-30` | Add a tone dot/icon and dock full-width on mobile. Low priority. |

Total: 24 findings (7 High, 10 Med, 7 Low).

## 3. Top 3 changes

### 3.1 Settings with real help and clear grouping

Goal: a user can pick a value without opening the YAML docs.

```
Network
-----------------------------------------------------------
Routing
  Strategy   [ Fill First  v ]
             Use one credential until it is exhausted, then move to the next.
  Session affinity   [on]    Pin a session to one credential to reuse caches.
    TTL      [ 1h ]   default 1h
    Subagent affinity [on]   (disabled when affinity is off: "Requires session affinity")

Retries
  Request retries [ 3 ] times     Max retry credentials [ 0 ] (0 = try all)
  Max retry interval [ 30 ] s     (0 or less = no wait between rounds)

Cooldowns
  Disable cooling [off]   danger style: "Failing credentials stay in rotation"
  Transient error cooldown [ 60 ] s  (408/500/502/503/504/520-526; 0 = default, negative = off)
  Persist cooldown status [off]  ...
  More (collapsed): video cache TTL, WS auth, gpt-image base model
```

Every field gets one sentence of purpose, a unit, a default, and what 0 or empty means. Select options each get a description. Groups use `FieldGroup`. Restart-required fields carry a pill.

### 3.2 Sticky command bar with a change-aware save flow

Goal: the page behaves like the Quota header, with search and sections always visible, and it says what you are about to save.

```
Config Panel        In sync / 3 unsaved / 1 error               [Reload]
[ Search 112 settings...  / ]                         [Visual | Source]   <- sticky
[ Overview  Access  Network  Logging  Streaming  Advanced  Payload ]     <- sticky
---------------------------------------------------------------------------
 (fields; dirty ones get an amber left rule and a small undo icon)

 Bottom bar:  3 unsaved: Network 2, Logging 1   [Review]  [Discard]  [Save]
              or: 1 error in Network   [Go to first error]
```

Review lists changes by label ("Routing strategy: round-robin to fill-first"), then shows the existing YAML diff for confirmation. Collapsed groups open themselves and show an error or dirty badge. Ctrl/Cmd+S opens Review.

### 3.3 Overview tab as a summary page, and safer dangerous settings

Goal: land on the state of the proxy rather than a form, and make risky switches look risky.

```
Overview
[0.0.0.0:8317] [Proxy: off] [3 API keys] [Strategy: fill-first] [Logs: file, debug off] [Quota fallback: 2 on]
 (cards link to the owning section; a card turns amber when something needs attention:
  remote access on, no management key, debug on, cooling disabled)

Access > Remote management
  Allow remote management  [off]   amber rule: "Other hosts can reach the management API."
  Management key [ ********  show ]   warning if remote is on and key is empty
  (turning remote on asks for confirmation)
```

This reuses the Quota page's summary-card vocabulary and gives the Common tab a purpose beyond duplicating fields.

## 4. Quick wins (each under 30 minutes)

- Rewrite the Routing Strategy hint and add hints for Session Affinity and Session Affinity TTL (copy only, `en.json` and the other locale files).
- Use a dedicated "API key copied" toast string (`ApiKeysCardEditor.tsx:136-142`).
- Replace "Client API Keys (access.api-keys)" and the "consistent with 'API Key Management' page style" hint with plain wording.
- Add the missing description to "Use Antigravity Credits" and a restart note to the Commercial Mode description.
- Add `role="alert"` to the field error box in `Input` and `FieldShell`, and link the description to the switch with `aria-describedby` in `ToggleRow`.
- Open a `Collapsible` by default when a child has a validation error (`defaultOpen={Boolean(error)}` in Connectivity, Discovery, Advanced, as Payload already does).
- Make the "Fix errors" status in `FloatingSaveBar` a button that calls `jumpToField` for the first error.
- Drop the static "N settings" from the header meta and show unsaved and error counts (`uiState.ts:201-208`).
- Extend the existing "Disabled" pill to retry interval, cooldown and log-size inputs when the value means off.
- Wire or remove the unused `extraActions` prop on `ConfigHeader`.
- Add Ctrl/Cmd+S for the save review and `/` to focus search.
- Add a clear button to the search input.
