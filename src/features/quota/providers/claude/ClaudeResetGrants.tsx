import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import { useAuthStore } from '@/stores/useAuthStore';
import { useNotificationStore } from '@/stores';
import { apiClient } from '@/services/api/client';
import type { AuthFileItem, ClaudeQuotaState } from '@/types';
import { normalizeAuthIndex } from '@/utils/quota';
import { formatCountdown } from '../../compactDuration';
import { formatQuotaWindowLabel } from '../../quotaWindows';
import { resetGrantOperations, RETRY_WINDOW_MS } from './resetGrantOperations';
import { confirmGuard, groupResetGrants, type ResetGrantGroup } from './resetGrantGroups';

/**
 * Grouped resets for one Claude credential, read from its loaded quota (the
 * same usage response). The session-scoped journal owns spending and the
 * re-read of status and organization right before a claim.
 */
export function useClaudeResetGrants(
  file: AuthFileItem,
  quota: ClaudeQuotaState | undefined,
  disabled: boolean,
  onRefresh: () => void
) {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [session] = useState(() => apiClient.getConnectionRevision());
  const sessionActive =
    connectionStatus === 'connected' && session === apiClient.getConnectionRevision();
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const now = useNow();
  const authIndex = normalizeAuthIndex(file.auth_index ?? file.authIndex);
  const key = JSON.stringify([file.name, authIndex]);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const loaded = quota?.status === 'success';
  const status = loaded ? (quota.resetGrants ?? null) : null;
  const operation = resetGrantOperations.inspect(key);
  const pending =
    operation && !operation.code
      ? { grantId: operation.grantId, expired: now - operation.createdAt >= RETRY_WINDOW_MS }
      : null;
  const groups = status ? groupResetGrants(status, quota?.windows ?? [], now, pending) : [];
  const blocked = disabled || !sessionActive || !authIndex || busy;
  const message = pending
    ? pending.expired
      ? 'expired'
      : 'unknown'
    : loaded && !status
      ? 'read_error'
      : '';

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
      message: t(action.retry ? 'claude_reset.retry_confirm' : 'claude_reset.confirm_text', {
        name: file.name,
        kind: t(`claude_reset.kind_${group.kind}`),
        windows,
      }),
      confirmText: t(action.retry ? 'claude_reset.retry' : 'claude_reset.confirm'),
      variant: 'primary',
      onConfirm: async () => {
        if (!current() || lock.current || useAuthStore.getState().connectionStatus !== 'connected')
          return;
        lock.current = true;
        setBusy(true);
        try {
          const answer = await resetGrantOperations.run(
            key,
            authIndex,
            action.grantId,
            action.retry
              ? undefined
              : confirmGuard(group.kind, action.grantId, quota?.windows ?? [])
          );
          if (!current()) return;
          showNotification(
            t(`claude_reset.${answer.unresolved ? 'unknown' : answer.code}`),
            !answer.unresolved && (answer.code === 'reset' || answer.code === 'already_used')
              ? 'success'
              : 'error'
          );
        } catch {
          if (!current()) return;
          const unresolved = resetGrantOperations.inspect(key);
          showNotification(
            t(`claude_reset.${unresolved && !unresolved.code ? 'unknown' : 'blocked'}`),
            'error'
          );
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
