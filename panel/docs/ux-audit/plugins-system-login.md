# UX audit: Plugins, Plugin Store, plugin pages, System, Login

Scope: `src/features/plugins/*`, `src/pages/SystemPage.tsx` (+ scss), `src/pages/LoginPage.tsx` (+ scss), and the sidebar integration in `src/components/layout/MainLayout.tsx`. This is a static code review. Nothing was run in a browser, so responsive and visual claims are inferred from the SCSS and marked as unverified where relevant. The quality bar is the Quota page: compact header with a meta line, summary cards, dense scannable rows, explicit states.

## 1. Summary of current state

The plugin pages are functionally thorough. They poll until runtime state settles, handle restart-required, have a careful third-party install gate, and offer a release-version picker. But they present everything at the same visual weight. The Plugins page is a flat list where each row carries up to four status badges, a raw path, an id, a red Delete button and a toggle, and it never links to the pages a plugin provides. The Store is a card grid that shows every metadata field on every card, under a permanent full-width security banner, and its third-party install path takes up to five interactions. The System page mixes unrelated things (about/version, links, a model list, sign-out), hides the request-log switch behind a 7-tap easter egg, and reports the update check only as a toast. The Login page works but is not a real form, hides connection-URL editing behind a checkbox, puts errors below the submit button, and has English-locale gaps. None of these pages use the Quota header-plus-summary-cards pattern, so they read as a different app. The theme and CSS variables are fine and should stay.

## 2. Findings

Ordered by impact on a daily user.

| # | Sev | Finding | File:line | Recommendation |
|---|-----|---------|-----------|----------------|
| 1 | High | Plugin rows show up to four badges (Effective/Inactive, Registered, Configured, OAuth) plus a toggle bound to a different field (`enabled`). A row can show the toggle ON next to an "Inactive" badge with no explanation. There is no single glanceable state. | PluginsPage.tsx:619-648, 678-682 | Collapse to one primary status chip derived from enabled/registered/effective/configured: Running (green), Disabled (muted), Needs config (amber), Restart needed / not loaded (amber), Error (red). Move Registered/Configured into a tooltip or the config sheet. Keep OAuth as a small tag. |
| 2 | High | The Plugins page never links to the pages a plugin provides. `plugin.menus` is only used as search text; sidebar entries are built elsewhere with no mapping back. A user cannot tell which plugin adds which sidebar item or jump to it. | PluginsPage.tsx:184; MainLayout.tsx:552-585 | Show a "Pages" count per row with Open links built via `buildPluginResourceRoute`. Only effective plugins get links. |
| 3 | High | Header and stats do not follow the Quota pattern. Plugins and Store each render a bulky `statusBar` of pills (global status, plugin directory path, counts). The directory path takes prime space and says little. "Effective 3/5" is ambiguous (effective of registered, not of discovered). Store's "Available" pill duplicates the "All" chip count. | PluginsPage.tsx:504-546; PluginStorePage.tsx:1045-1088 | Replace with a Quota-style header (title, one mono meta line such as "7 discovered, 4 running, 1 needs attention") plus 3-4 summary cards (Running, Disabled, Needs attention, Updates). Move the directory to a footer line or tooltip. Share one component across both pages. |
| 4 | High | Third-party install is up to five interactions: card Install, options modal (version radios), gate step 1 (identity only, a button that just advances), gate step 2 (risk text), gate step 3 (type the repo slug). Step 1 carries no decision. The same gauntlet runs for updating an already-installed third-party plugin. | PluginStorePage.tsx:739-770; PluginInstallGateModal.tsx:117-185 | Merge step 1 into step 2 (identity header plus risks in one view). Keep the typed confirmation for first install only; for updates from the same source use a single confirm showing old to new version. Fold version choice into the same modal. |
| 5 | High | Config sheet gives no feedback while opening: `open` requires the draft to be loaded, so the only signal is a spinner on the row button. Failure closes into a toast. Saving always closes the sheet, even for `runtime_pending`/`globalDisabled`. Closing with edits discards them silently; no dirty indicator. | PluginsPage.tsx:198-232, 267-330, 725-729 | Open the sheet immediately with a skeleton body. Show a dirty marker and confirm on close when dirty. On `runtime_pending` keep the sheet open with an inline warning rather than toast plus close. |
| 6 | High | Login is not a `<form>`. Enter submits only from the key input; the custom URL input and the remember checkbox ignore Enter. Password managers and autofill do better with a real form. | LoginPage.tsx:190-198, 270-278, 280-309, 321 | Wrap fields in `<form onSubmit>` with a `type="submit"` button and drop the manual keydown handler. |
| 7 | High | Login connection URL: a read-only "Current URL" box with a hint paragraph, plus a separate checkbox that reveals a second input. Two steps to change a URL. The displayed value is the raw typed string, not what will be used after `normalizeApiBase`. The field does not auto-open after network/CORS/404 failures, which are exactly the cases where the URL is wrong. | LoginPage.tsx:254-278, 161 | One row: "Connecting to http://host:8317  [Change]". Change turns it into an input with a normalized preview. Auto-open it on `error_network`, `error_cors`, `error_not_found`. Remove the standalone checkbox and the two hint lines. |
| 8 | High | Login error handling: the error box renders below the submit button (can fall below the fold on mobile), has no `role="alert"`, and the same message is also sent as a toast, so it shows twice. `error_required` says "complete connection information" though only the key is required. `error_forbidden` packs four causes into one sentence. | LoginPage.tsx:170-176, 325; en.json login.error_* | Place the message directly above the button (or on the key field via `Input error=`), add `role="alert"`, clear it on edit, drop the duplicate toast. Reword required to "Enter the management key". Split forbidden into a headline plus a short causes list. |
| 9 | Med | The update check result is a transient toast. The API Version tile keeps showing the same number afterwards; there is no persisted "latest vX / up to date", no release link, and no WebUI version check. Tile labels "Version" vs "API Version" are ambiguous. | SystemPage.tsx:238-269, 318-335 | Show the result inside the tile ("Up to date" green, or "v8.4.1 available" amber with a link). Rename tiles "Management Center" and "CLIProxyAPI". Show last-checked time. |
| 10 | Med | Models card is a wall of tags: every group fully expanded, no search, no copy, no total at the top. The status badge ("N available models"), each group's "N available models", and a separate loading hint repeat the same information. It is the most data-heavy section and the least scannable. The API key used for the fetch is not shown. | SystemPage.tsx:409-463, 143-160 | Header row with total, search box, collapse-all. Groups collapsed except the first. Click a tag to copy the id. Show "via key sk-...abcd" and a clearer empty state when no API keys exist. Consider giving it its own section ahead of the Links card. |
| 11 | Med | Request logging is toggled by tapping the Version tile seven times. It is undiscoverable, has no affordance, and request logging has privacy and disk implications that deserve a visible control. | SystemPage.tsx:185-202, 307-316, 475-507 | Move to Basic Settings or a visible "Diagnostics" card on this page with the existing warning text. Make the Version tile a plain div. |
| 12 | Med | Plugin pages (iframe) have minimal states. Loading is bare text; error and not-found states are EmptyStates with no action; no detection of iframe load failure; no toolbar showing which plugin/page this is, and no "open in new tab". It refetches the full plugin list on every navigation even though MainLayout already loaded it. The iframe has no `sandbox` attribute while granting clipboard read/write. | PluginResourcePage.tsx:46-67, 92-122 | Use the shared skeleton/spinner. Add actions ("Back to Plugins", "Retry"). Use iframe `onLoad` and show a hint if it does not load in a few seconds. Add a thin toolbar (plugin name, Reload, Open in new tab). Consider sharing list data via a store. Review whether `sandbox` can be applied. |
| 13 | Med | The permanent security banner sits above everything, including errors, and pushes the first card below the fold on laptop heights. Official plugins get no positive marker; only third-party gets a badge, so trust is communicated by absence. | PluginStorePage.tsx:994-1002, 844-849 | One-line collapsible note (dismissal remembered); keep full text in the gate. Add an "Official" badge (green, shield icon) so both states are explicit. |
| 14 | Med | Store cards show every field at equal weight: install type, platforms, source, author, license, version, tags, description with show-more, plus up to four badges. No sort, and no source filter although multiple sources exist. Cards are tall and hard to compare. | PluginStorePage.tsx:895-935, 1104-1121 | Compact card: logo, name, one-line description, version chip, one state chip, primary action. Put install type/platforms/license/source/tags in a details Sheet. Add Sort and a Source select when more than one source exists. |
| 15 | Med | Install options modal makes the common case (latest) heavy: three radio cards, a live browser call to `api.github.com` on open (unauthenticated, 60 requests/hour per IP, and it exposes the user's IP to GitHub), and a manual-tag mode. | PluginStorePage.tsx:284-460; pluginReleaseVersions.ts:13 | Default view: "Install v1.2.3 (latest)  [Choose another version]". Fetch releases only when that link is opened. Explain rate-limit errors plainly, keep manual tag as the fallback inside that disclosure. |
| 16 | Med | Auth-required plugins get a disabled Install button whose reason lives in a `title` tooltip and refers to a config key. Tooltips on disabled buttons are unreliable on touch and keyboard. | PluginStorePage.tsx:210-211, 925-931 | Show an inline amber line on the card ("Needs plugins.store-auth in config") instead of relying on a tooltip. |
| 17 | Med | "Manage" on an installed Store card goes to the generic `/plugins` list with no focus on that plugin. The restart-required notice is page-local state: lost on reload and invisible elsewhere. | PluginStorePage.tsx:948, 476, 1033-1037 | Navigate to `/plugins?focus=<id>` and scroll/highlight the row or open its config sheet. Persist restart-required in a store and show it on both pages. |
| 18 | Med | Plugins empty/error states: "No plugins" is used for both "none installed" and "search matched nothing"; the empty state has no link to the Store; the load error has no Retry (Store has one); filtering is free text only (Store has status chips). Global `plugins.enabled=false` is a warning with no action. | PluginsPage.tsx:496-503, 550-600 | Split empty states (none installed with a "Browse Plugin Store" action; no matches with "Clear search"). Add Retry to the error box. Add filter chips (All, Running, Disabled, Needs attention) with counts. |
| 19 | Med | Delete is an always-visible red labelled button on every row beside the routine toggle and Edit config. Toggle, Edit and Delete all share one accessible name across rows ("Enabled", "Edit config", "Delete"), so screen-reader users cannot tell rows apart. | PluginsPage.tsx:672-720 | Make Delete an icon-only ghost button, or move it into the config sheet footer. Include the plugin title in all `ariaLabel`/`aria-label` values. |
| 20 | Med | Config fields use the raw field `name` as the label, render array/object values as a JSON textarea, and never mask secret-looking values. The i18n file contains unused keys for an array editor (`add_array_item`, `remove_array_item`, `array_item_placeholder`), suggesting an editor was planned. | PluginsPage.tsx:370-440; en.json plugin_management | Use a label from the schema if available, mask fields whose name suggests a secret with a show toggle, and either build the array editor or remove the dead keys. |
| 21 | Med | Login auto-restore forces a 1.5 s success splash on every visit, cannot be skipped, and has no failure message when restore fails: the user just sees the form with no hint why. | LoginPage.tsx:129-153, 206 | Navigate on success with at most a ~300 ms fade. If restore fails, show a one-line note with the reason. |
| 22 | Med | Login first-run clarity: the card only says "Connect to CLI Proxy API v8 or later". Nothing says where the management key comes from. "Remember password" is misleading; it is a management key stored obfuscated in localStorage on this device. | LoginPage.tsx:251, 280-319; en.json login.* | Add a one-line helper under the key field (where the key is set, link to docs). Relabel to "Remember key on this device". Drop trailing colons in `management_key_label` and `custom_connection_label`. |
| 23 | Low | The show/hide key labels fall back to hard-coded Chinese `defaultValue`s and `login.show_key` / `login.hide_key` are absent from en.json, so English users get Chinese aria-labels. The clear-login confirmation title also has a hard-coded English default. | LoginPage.tsx:295-304; SystemPage.tsx:165 | Add the keys to all locales and remove the inline defaults. |
| 24 | Low | "Local Login Data" is a full Card with a lone danger button, equal in weight to Models. Connection status and URL live in a separate tile in About. | SystemPage.tsx:342-346, 465-472 | Merge into a compact "Session" card: URL, status dot, Sign out, Clear saved login. |
| 25 | Low | Single-page plugins appear in the sidebar by menu label only, so two plugins that both declare "Dashboard" are indistinguishable. | MainLayout.tsx:552-565; pluginResources.ts:99-108 | Use "Plugin name: Menu" or put the plugin name in the meta line. |
| 26 | Low | The Store can stack an error box, a source-errors list, a global-disabled warning and a restart banner before any content, each full width. | PluginStorePage.tsx:1006-1037 | One alert stack with a collapsed summary; source errors become a toolbar chip with a popover. |
| 27 | Low | Duplicated styling and components: `statusBar`, skeletons, warning/error boxes, and three copies of the logo-with-fallback component across PluginsPage (587 lines SCSS), PluginStorePage (857) and the gate modal. Visual drift will keep accumulating. | PluginsPage.tsx:46; PluginStorePage.tsx:93; PluginInstallGateModal.tsx:27 | Extract a shared `PluginLogo` and shared header/summary when doing #3. |
| 28 | Low | Responsive (inferred from SCSS, unverified): the Plugins row action cluster is capped at `min(560px, 48vw)`, which at roughly 800-1000 px may squeeze the name/path column. Mobile drops actions to a second row, which is fine. | PluginsPage.module.scss:342-363 | Check in a browser at 900 px; consider moving actions to their own line below 1100 px or hiding button labels. |

Items 1-8 are the daily-use set. Total: 28 findings.

## 3. Top 3 changes

### A. Plugins page: one status per plugin, summary cards, links to plugin pages

```
Plugins                                                [Store] [Refresh]
| 7 discovered · 4 running · 1 needs attention · 1 update

[ Running 4 ] [ Disabled 2 ] [ Needs attention 1 ] [ Updates 1 ]   (cards, click to filter)

[search plugins...                   ]   All  Running  Disabled  Attention

[logo] Usage Exporter  v1.2.0 · acme          (Running)   Pages: 2 v   [toggle] [gear] [...]
       usage-exporter
[logo] Quota Alerts    v0.4.1 · router-for-me (Needs config)          [toggle] [gear] [...]
       Needs a webhook URL                      Configure ->
```

Covers findings 1, 2, 3, 18, 19. One status chip, a one-line reason under the name when not Running, a Pages popover with Open links, Delete in the overflow menu, empty state with a Store link. Reuse the Quota header and summary-card styles.

### B. Store: compact cards, light path for official plugins, shorter gate for third-party

```
Plugin Store                                            [Refresh]
| 31 available · 3 installed · 1 update       (i) Third-party plugins run with full backend access [Details]

All 31 | Installed 3 | Not installed 28 | Updates 1     Sort [Name v]  Source [All v]  [search...]

+-----------------------------+  +-----------------------------+
| [logo] Usage Exporter       |  | [logo] Fancy Router         |
| [Official] v1.2.0           |  | [Third-party] v0.9.0        |
| One-line description...     |  | One-line description...     |
| [Install]          (i) [GH] |  | [Install]          (i) [GH] |
+-----------------------------+  +-----------------------------+
```

Install modal: "Install Usage Exporter v1.2.0 (latest)  [Choose another version]". Third-party: step 1 shows identity and risks together, step 2 is the typed confirmation; updating an already-installed plugin skips the typing. Details (platforms, install type, license, source, tags) sit behind the (i) button. Covers findings 4, 13-17, 26.

### C. System page and Login: useful things first, failures explicit

System:
```
Management Center
| WebUI v1.8.0 · CLIProxyAPI v8.4.0 - up to date (checked 2 min ago) [Check] · built 2026-09-30

Session      Connected to http://127.0.0.1:8317     [Sign out] [Clear saved login]
Diagnostics  Request log [toggle]   (existing warning text)
Models 143   [search models...] [Collapse all]   via key sk-...ab12   [Refresh]
   > Claude (12)   > GPT (20)   > Gemini (9) ...      click an id to copy
Links        Main repo · WebUI repo · Docs    (one line of small links)
```

Login:
```
Connect to CLIProxyAPI
Connecting to  http://127.0.0.1:8317   [Change]
Management key  [••••••••••••] [eye]
  The key set in your CLIProxyAPI config. Docs
[ ] Remember key on this device
(error here, role=alert: "HTTP 401: key rejected. Check ...")
[ Connect ]
```

Real `<form>`, Enter works everywhere, URL field auto-opens on network/CORS/404 errors, no forced 1.5 s splash. Covers findings 6-11, 21-24.

## 4. Quick wins (each under 30 minutes)

1. Add `login.show_key` / `login.hide_key` to every locale and delete the Chinese `defaultValue`s (23).
2. Wrap the login fields in `<form onSubmit>` with a submit button (6).
3. Move the login error above the submit button, add `role="alert"`, stop duplicating it as a toast (8).
4. Reword `login.error_required` to "Enter the management key" and drop trailing colons from login labels (8, 22).
5. Cut the 1.5 s `setTimeout` after auto-login success to about 300 ms (21).
6. Include the plugin title in the toggle, Edit config and Delete aria-labels on each Plugins row (19).
7. Add a Retry button to the Plugins error box, matching the Store (18).
8. Split the Plugins empty state into "none installed" (with a Store button) and "no search results" (18).
9. Show the update-check result inline in the API Version tile instead of only a toast (9).
10. Rename the "Version" / "API Version" tiles to "Management Center" / "CLIProxyAPI" (9).
11. Make the Version tile a non-button and add a visible Request log control or hint (11).
12. Add an "Official" badge to Store cards for official plugins (13).
13. Add Retry / Back actions to the `PluginResourcePage` EmptyStates (12).
14. Remove the "Available" pill from the Store status bar since the "All" chip shows the count (3).
15. Remove the unused i18n keys `add_array_item`, `remove_array_item`, `array_item_placeholder` or build the editor (20).
