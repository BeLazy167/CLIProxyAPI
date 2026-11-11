import { apiClient } from '@/services/api/client';
import { authFilesApi } from '@/services/api/authFiles';
import {
  anthropicResetGrantBlocker,
  claimClaudeResetGrant,
  readClaudeOrganization,
  readClaudeResetGrants,
  type AnthropicResetGrantStatus,
  type AnthropicResetSettledCode,
} from '@/services/api/claudeResetGrants';

export const RETRY_WINDOW_MS = 10 * 60 * 1000;
type Operation = {
  grantId: string;
  organization: string;
  requestId: string;
  createdAt: number;
  code?: AnthropicResetSettledCode;
};
/** A settled claim whose gateway cooldown could not be cleared afterwards. */
export type ResetGrantRunCode = AnthropicResetSettledCode | 'cooldown_clear_failed';

const defaultDependencies = {
  revision: () => apiClient.getConnectionRevision(),
  readStatus: readClaudeResetGrants,
  readOrganization: readClaudeOrganization,
  claim: claimClaudeResetGrant,
  resetCooldown: authFilesApi.resetCooldown,
  now: () => Date.now(),
  requestId: () => crypto.randomUUID() as string,
};
export type ResetGrantOperationDeps = typeof defaultDependencies;

/** Tab-memory journal: survives dialog/card unmounts, never crosses connections.
 * No automatic retry. Expired ambiguous operations stay blocked until session end.
 * This is not a cross-tab or durable backend spending ledger.
 */
export function createResetGrantOperations(deps = defaultDependencies) {
  let revision = deps.revision();
  const operations = new Map<string, Operation>();
  const busy = new Set<string>();
  const syncSession = () => {
    if (revision !== deps.revision()) {
      revision = deps.revision();
      operations.clear();
      busy.clear();
    }
    return revision;
  };
  return {
    inspect(key: string) {
      syncSession();
      return operations.get(key);
    },
    async run(
      key: string,
      authIndex: string,
      grantId: string,
      /** Checked on the fresh status of a new claim; a retry keeps its request and skips it. */
      guard?: (status: AnthropicResetGrantStatus, now: number) => boolean
    ): Promise<{ code: ResetGrantRunCode; unresolved: boolean }> {
      const session = syncSession();
      const assertSession = () => {
        if (deps.revision() !== session) throw new Error('session');
      };
      if (busy.has(key)) throw new Error('busy');
      busy.add(key);
      try {
        let operation = operations.get(key);
        if (operation?.code) operation = undefined;
        if (
          operation &&
          (operation.grantId !== grantId || deps.now() - operation.createdAt >= RETRY_WINDOW_MS)
        )
          throw new Error('expired');
        const wasRetry = Boolean(operation);
        const organization = await deps.readOrganization(authIndex);
        assertSession();
        if (operation && operation.organization !== organization) throw new Error('identity');
        if (!operation) {
          const status = await deps.readStatus(authIndex);
          assertSession();
          const grant = status.grants.find((item) => item.id === grantId);
          const now = deps.now();
          if (
            anthropicResetGrantBlocker(status, grantId) ||
            !grant ||
            (grant.startsAt && Date.parse(grant.startsAt) > now) ||
            (grant.endsAt && Date.parse(grant.endsAt) <= now) ||
            (status.cooldownUntil && Date.parse(status.cooldownUntil) > now) ||
            (guard && !guard(status, now))
          ) {
            throw new Error('blocked');
          }
          operation = { grantId, organization, requestId: deps.requestId(), createdAt: now };
          operations.set(key, operation);
        }
        // Re-check immediately before dispatch; never send against a replacement connection.
        assertSession();
        if (wasRetry && deps.now() - operation.createdAt >= RETRY_WINDOW_MS) {
          throw new Error('expired');
        }
        const code = await deps.claim(authIndex, organization, grantId, operation.requestId);
        assertSession();
        // A refusal on a retry cannot prove that the earlier ambiguous POST did not spend.
        if (!wasRetry || code === 'reset' || code === 'already_used') operation.code = code;
        if (code === 'reset' || code === 'already_used') {
          // The gateway keeps its own cooldown for this credential until told
          // otherwise, so a reset upstream is useless until it is cleared here.
          try {
            await deps.resetCooldown(authIndex);
          } catch {
            assertSession();
            return { code: 'cooldown_clear_failed', unresolved: false };
          }
          assertSession();
        }
        return { code, unresolved: !operation.code };
      } finally {
        if (deps.revision() === session) busy.delete(key);
      }
    },
  };
}

export const resetGrantOperations = createResetGrantOperations();
