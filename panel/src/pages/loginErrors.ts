import type { ApiError } from '@/types';
import { LegacyBackendError } from '@/services/api/legacyBackendProbe';

export interface LoginError {
  message: string;
  /** Short list of likely causes, rendered under the headline. */
  causes?: string[];
  /** The address is the likely problem: open the connection editor. */
  connection?: boolean;
}

/**
 * 将 API 错误转换为本地化的用户友好消息
 */
export function getLocalizedLoginError(error: unknown, t: (key: string) => string): LoginError {
  if (error instanceof LegacyBackendError) return { message: t('login.error_legacy_backend') };
  const apiError = error as Partial<ApiError>;
  const status = typeof apiError.status === 'number' ? apiError.status : undefined;
  const code = typeof apiError.code === 'string' ? apiError.code : undefined;
  const message =
    error instanceof Error
      ? error.message
      : typeof apiError.message === 'string'
        ? apiError.message
        : typeof error === 'string'
          ? error
          : '';
  const lower = message.toLowerCase();

  const withHttpStatus = (summary: string) => {
    if (!status) {
      return summary;
    }

    const genericAxiosMessage = `Request failed with status code ${status}`;
    const detail = message.trim();
    const backendDetail =
      detail && detail !== genericAxiosMessage
        ? ` (${t('login.error_backend_detail')}: ${detail})`
        : '';

    return `HTTP ${status}: ${summary}${backendDetail}`;
  };

  // 根据 HTTP 状态码判断
  if (status === 401) {
    return { message: withHttpStatus(t('login.error_unauthorized')) };
  }
  if (status === 403) {
    return {
      message: withHttpStatus(t('login.error_forbidden')),
      causes: [
        t('login.error_forbidden_cause_remote'),
        t('login.error_forbidden_cause_key'),
        t('login.error_forbidden_cause_banned'),
      ],
    };
  }
  if (status === 404) {
    return { message: withHttpStatus(t('login.error_not_found')), connection: true };
  }
  if (status && status >= 500) {
    return { message: withHttpStatus(t('login.error_server')) };
  }

  // 根据 axios 错误码判断
  if (code === 'ECONNABORTED' || lower.includes('timeout')) {
    return { message: t('login.error_timeout') };
  }
  if (code === 'ERR_NETWORK' || lower.includes('network error')) {
    return { message: t('login.error_network'), connection: true };
  }
  if (code === 'ERR_CERT_AUTHORITY_INVALID' || lower.includes('certificate')) {
    return { message: t('login.error_ssl') };
  }

  // 检查 CORS 错误
  if (lower.includes('cors') || lower.includes('cross-origin')) {
    return { message: t('login.error_cors'), connection: true };
  }

  // 默认错误消息
  return { message: withHttpStatus(t('login.error_invalid')) };
}
