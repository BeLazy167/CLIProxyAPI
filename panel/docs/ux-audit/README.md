# UX audit: CPAMC management panel

Date: 2026-10-07. Seven parallel audits (Sonnet, medium effort), one per area, with the Quota Management page as the quality bar. Audit only. No source changes were made. Keep the existing theme and tokens; the problems are hierarchy, density, states and consistency, not color.

| Report | Area | Findings |
|---|---|---|
| [shell-and-design-system.md](shell-and-design-system.md) | Layout, tokens, shared components, i18n | 22 |
| [dashboard-quick-start.md](dashboard-quick-start.md) | Dashboard, Quick Start | 18 |
| [auth-files-oauth.md](auth-files-oauth.md) | Credential Vault, OAuth | 20 |
| [ai-providers.md](ai-providers.md) | AI Providers workbench and sheet | 26 |
| [logs.md](logs.md) | Live logs, request error logs | 20 |
| [config-panel.md](config-panel.md) | Config Panel | 24 |
| [plugins-system-login.md](plugins-system-login.md) | Plugins, Plugin Store, System, Login | 30 |

Total: 160 findings. The sections below collapse them into the themes that repeat across reports and a build order.

## 1. Cross-cutting themes

1. **The Quota page pattern exists in three places and nowhere shared.** Quota, Vault and Config each copy the compact header (title, mono meta line, pill actions). Logs, Plugins, Store, OAuth, System, Providers and Dashboard each use a different header. Six copies of the ink pill button, 13 spin keyframes, 7 error-box styles, two paginations and two search fields. Fix once: `PageHeader`, `MetaLine`, `Button shape="pill"`, `Select variant="quiet"`, `SearchField`, `ErrorBanner`, `Pagination`.
2. **Lists are cards, not ledgers.** Vault cards are about 200px per credential, Providers rows 174px, Plugins rows carry four badges and a raw path, Store cards show every metadata field. Every page-level report asks for the Quota ledger row (identity cell, dense body cells, one action) and a summary strip above it. Vault and Quota should share the same grouped row component.
3. **Empty, loading and error states are weak or misleading.** Failed fetches look like "no data" on Dashboard, Vault and Plugins. Spinners where skeletons belong. Error toasts last 3s with the info icon. Only the Store has a Retry button. Rule from the design-system report: skeletons for lists, inline `ErrorBanner` with Retry for load failures, toasts only for action results, errors persist about 8s.
4. **Destructive actions look like everything else.** Vault delete sits beside the filters with a "Confirm" label; batch disable has no confirm; Plugins has a red Delete on every row; Config's dangerous toggles (Allow Remote Access, Disable Cooling, Disable cloaking) are styled like harmless ones; `ConfirmationModal` swallows failures and focuses the close X.
5. **Light-theme contrast fails AA.** Tertiary and quaternary text, success and warning used as text, all under 3:1. The Quota meta line is affected. Warning and error are the same red. Needs `--success-text`, `--warning-text`, `--danger-text`, a darker light `--text-tertiary`, and amber as the real warning color.
6. **Keyboard and screen-reader gaps.** No focus ring on `ToggleSwitch` or `.btn`, header menus without arrow keys, icon buttons with `title` but no `aria-label`, `Input` aria-describedby bug, chart columns not focusable, Login not a real form, Modal title not a heading.
7. **i18n drift.** `fallbackLng` is zh-CN so missing keys show Chinese to everyone else. Chinese `defaultValue`s in Vault and Login. Locale key sets differ from en by 6 to 8 keys each. Hardcoded "Back" and "Loading..." in the shell.
8. **Email masking is Quota-only.** Vault, Providers and OAuth show raw emails. Reuse `maskIdentity` and the Show emails toggle everywhere identities appear.
9. **Hierarchy inverted on the Dashboard.** Slogan hero, 80px headline, large gaps, data below the fold, and it never names which credential or provider is failing.

## 2. Build order

Phase 1, foundation (unblocks everything else):
- Shared primitives from the design-system report (theme 1), with Quota, Vault and Config migrated first since that is mostly deletion.
- Token and contrast pass: status text colors, radius and type scale vars, `--focus-ring`, global `:focus-visible`, one reduced-motion block.
- Dialog and feedback hardening: `useDialog` shared by Modal and Sheet, `ConfirmationModal` error display and Cancel focus on danger, error toast duration and icon, `Input` fix.
- i18n: `fallbackLng: 'en'`, missing keys, CI key-set diff.

Phase 2, highest daily-use pages:
- **Vault**: grouped ledger rows shared with Quota, masked emails, delete moved into a batch bar with counts in confirms, batch disable confirm.
- **Dashboard**: replace the hero with the compact header plus one KPI row that names the failing credential or provider; add loading, error and keyboard states; Quick Start as a four-step guided setup with an endpoint to copy and a verify step.
- **Logs**: failure-first quick filters out of the modal and visible as chips, live tail on by default with a state pill, columnar rows (time, status, method, path, latency), error log files as a ledger, real error states.

Phase 3, remaining pages:
- **Providers**: dense ledger rows showing priority and weight, inline connectivity test with timing and history, a real read-only detail view, grouped edit form with errors at the top.
- **Config**: help text that explains instead of restating labels, grouping of the Network tab, disable dependent fields, visually flag dangerous toggles with restart notes inline, sticky search and tabs, save bar that says what changed, Overview tab as a summary.
- **Plugins and Store**: one status per plugin, summary cards, links to plugin pages, compact Store cards with an Official badge and a shorter third-party gate.
- **System and Login**: useful tiles first with update-check result inline, visible request-log control instead of the 7-tap easter egg, Login as a real form with the error above the submit button.
- **OAuth**: provider list with one active-login panel (open link, authorize, paste callback), consistent cancel and retry, success message naming the new credential.

## 3. Quick wins

Each under 30 minutes. Full per-page lists are in the reports.

- `fallbackLng: 'en'`; add missing confirm-title and `login.show_key`/`hide_key` keys to all five locales; delete Chinese `defaultValue`s.
- `Button` defaults to `type="button"`; `Input` spread order fix plus `role="alert"`; `ToggleSwitch` focus ring.
- Error toasts: warning icon and longer duration. Retry buttons on the Plugins, Providers and Logs error boxes.
- Mask emails on Vault cards with a local Show emails toggle.
- Delete confirms include count and provider and say "Delete", not "Confirm". Add a confirm to batch disable.
- Dashboard: gap from 44-76px down to about 32px, drop the version row, minimum-sample guard so two requests cannot show red.
- Logs: live tail default on, time column `HH:mm:ss` only, no badge for info/debug/trace, `/` to focus search.
- Config: rewrite the Routing Strategy, Session Affinity and TTL hints, open a collapsible when a child has an error, make "Fix errors" jump to the first error, Ctrl+S opens save review.
- Login: wrap in `<form onSubmit>`, error above the button, cut the 1.5s post-login delay to about 300ms.
- Shell: `aria-label` on refresh and logout, persist sidebar collapsed state, inline theme script in `index.html` to stop the light flash.
