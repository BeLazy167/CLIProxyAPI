import { describe, expect, test } from 'bun:test';
import { getAuthFileStatusKind, isProblemAuthFile } from '../src/features/authFiles/constants';
import type { AuthFileItem } from '../src/types';

const authFile = (overrides: Partial<AuthFileItem> = {}): AuthFileItem => ({
  name: 'credential.json',
  type: 'codex',
  ...overrides,
});

describe('auth file problem status', () => {
  test('does not classify a deliberately disabled credential as a problem', () => {
    expect(
      isProblemAuthFile(
        authFile({
          disabled: true,
          status: 'disabled',
          statusMessage: 'disabled via management API',
        })
      )
    ).toBe(false);
  });

  test('also respects the backend disabled status when the boolean is absent', () => {
    expect(
      isProblemAuthFile(
        authFile({
          status: ' DISABLED ',
          statusMessage: 'disabled via management API',
        })
      )
    ).toBe(false);
  });

  test('ignores healthy status messages', () => {
    expect(isProblemAuthFile(authFile({ status: 'active', statusMessage: 'ok' }))).toBe(false);
  });

  test('detects warning messages, unavailable credentials, and error status', () => {
    expect(isProblemAuthFile(authFile({ statusMessage: 'quota exhausted' }))).toBe(true);
    expect(isProblemAuthFile(authFile({ unavailable: true }))).toBe(true);
    expect(isProblemAuthFile(authFile({ status: 'error' }))).toBe(true);
  });
});

describe('auth file status buckets with cooldowns', () => {
  const NOW = Date.parse('2026-11-12T22:00:00Z');
  const cooling = (
    reason: string,
    remainingSeconds: number,
    overrides: Partial<AuthFileItem> = {}
  ) =>
    authFile({
      type: 'claude',
      status: 'error',
      unavailable: true,
      statusMessage: '{"type":"error","error":{"type":"rate_limit_error"}}',
      cooldownSnapshot: {
        receivedAtMs: NOW,
        records: [
          { scope: 'credential', reason, retryAt: '2026-11-14T21:00:02Z', remainingSeconds },
        ],
      },
      ...overrides,
    });

  test('a credential held only by a running quota cooldown is cooling down, not a problem', () => {
    for (const reason of ['credential_quota', 'quota']) {
      const file = cooling(reason, 166_035);
      expect(isProblemAuthFile(file, NOW)).toBe(false);
      expect(getAuthFileStatusKind(file, NOW)).toBe('cooling');
    }
  });

  test('an auth cooldown stays a problem', () => {
    for (const reason of ['unauthorized', 'invalid_grant', 'payment_required']) {
      expect(getAuthFileStatusKind(cooling(reason, 600), NOW)).toBe('problem');
    }
  });

  test('a quota cooldown mixed with an auth cooldown stays a problem', () => {
    const file = cooling('credential_quota', 600);
    file.cooldownSnapshot!.records!.push({
      scope: 'model',
      reason: 'unauthorized',
      retryAt: '2026-11-14T21:00:02Z',
      remainingSeconds: 600,
    });
    expect(getAuthFileStatusKind(file, NOW)).toBe('problem');
  });

  test('an error that outlives its quota cooldown is a problem again', () => {
    expect(getAuthFileStatusKind(cooling('credential_quota', 60), NOW + 61_000)).toBe('problem');
  });

  test('disabled wins over a running quota cooldown', () => {
    expect(getAuthFileStatusKind(cooling('quota', 600, { disabled: true }), NOW)).toBe('disabled');
  });
});
