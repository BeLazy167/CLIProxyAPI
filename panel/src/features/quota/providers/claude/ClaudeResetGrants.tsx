import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import { useAuthStore } from '@/stores/useAuthStore';
import { useNotificationStore } from '@/stores';
import { apiClient } from '@/services/api/client';
import { claimClaudeResetGrant } from '@/services/api/claudeResetGrants';
import type { AuthFileItem, ClaudeQuotaState } from '@/types';
import { normalizeAuthIndex } from '@/utils/quota';
import { formatCountdown } from '../../compactDuration';
import { formatQuotaWindowLabel } from '../../quotaWindows';
import { groupResetGrants, type ResetGrantGroup } from './resetGrantGroups';

/**
 * Grouped resets for one Claude credential, read from its loaded quota (the
 * same usage response). A confirmed spend asks the claude-quota plugin to
 * claim, and the panel shows the plugin's answer.
 */
export function useClaudeResetGrants(
  file: AuthFileItem,
  quota: ClaudeQuotaState | undefined,
  disabled: boolean,
  onRefresh: () => void
) {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const [session] = useState(() => apiClient.getConnectionRevision());
  const sessionActive =
    connectionStatus === 'connected' && session === apiClient.getConnectionRevision();
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const now = useNow();
  const authIndex = normalizeAuthIndex(file.auth_index ?? file.authIndex);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const loaded = quota?.status === 'success';
  const status = loaded ? (quota.resetGrants ?? null) : null;
  const groups = status ? groupResetGrants(status, quota?.windows ?? [], now) : [];
  const blocked = disabled || !sessionActive || !authIndex || busy;
  const message = loaded && !status ? 'read_error' : '';

  const confirm = (group: ResetGrantGroup) => {
    const action = group.action;
    if (blocked || lock.current || action.state !== 'ready' || !authIndex) return;
    const current = () => session === apiClient.getConnectionRevision();
    const windows = action.windows
      .map((reading) => {
        const label = formatQuotaWindowLabel(t, reading.label);
        const percent = reading.usedPercent === null ? '--' : Math.round(reading.usedPercent);
        return reading.resetAtMs !== null && reading.resetAtMs > now
          ? t('claude_reset.window_use_reset', {
              label,
              percent,
              time: formatCountdown(t, reading.resetAtMs - now),
            })
          : t('claude_reset.window_use', { label, percent });
      })
      .join(', ');
    showConfirmation({
      title: t('claude_reset.title'),
      message: t('claude_reset.confirm_text', {
        name: file.name,
        kind: t(`claude_reset.kind_${group.kind}`),
        windows,
      }),
      confirmText: t('claude_reset.confirm'),
      variant: 'primary',
      onConfirm: async () => {
        if (!current() || lock.current || useAuthStore.getState().connectionStatus !== 'connected')
          return;
        lock.current = true;
        setBusy(true);
        try {
          const answer = await claimClaudeResetGrant(apiBase, authIndex, action.grantId);
          if (!current()) return;
          showNotification(
            answer.state
              ? t('claude_reset.answer', { message: answer.message, state: answer.state })
              : answer.message,
            answer.ok ? 'info' : 'error'
          );
        } catch {
          if (!current()) return;
          showNotification(t('claude_reset.unknown'), 'error');
        } finally {
          lock.current = false;
          setBusy(false);
          if (current()) onRefresh();
        }
      },
    });
  };

  return { groups, busy, blocked, message, confirm };
}

export type ClaudeResetGrantsView = ReturnType<typeof useClaudeResetGrants>;
