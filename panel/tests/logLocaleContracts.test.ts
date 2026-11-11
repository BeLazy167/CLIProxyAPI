import { describe, expect, test } from 'bun:test';
import en from '../src/i18n/locales/en.json';
import zhCN from '../src/i18n/locales/zh-CN.json';
import zhTW from '../src/i18n/locales/zh-TW.json';
import ru from '../src/i18n/locales/ru.json';

const keys = [
  'preview_too_large',
  'read_status_live',
  'read_status_paused',
  'read_status_catching_up',
  'last_updated',
  'buffer_scope',
  'evicted_note',
  'read_status_retrying',
  'read_status_retrying_short',
  'retry_now',
  'jump_to_latest',
  'showing_window',
  'tab_live',
  'tab_errors',
  'quick_all',
  'quick_errors',
  'view_menu_title',
  'more_menu_title',
  'download_visible',
  'active_filters',
  'clear_all_filters',
  'remove_filter',
  'chip_level',
  'chip_search',
  'chip_request_id',
  'chip_hide_management',
  'search_matches',
  'search_empty_filters',
  'meta_lines',
  'meta_requests',
  'meta_errors',
  'meta_5xx',
  'not_connected_title',
  'not_connected_desc',
  'copy_request_id',
  'filter_request_id',
  'severity_warning',
  'severity_error',
  'error_logs_count',
  'error_logs_newest',
  'error_logs_search_placeholder',
  'error_logs_col_request',
  'error_logs_col_file',
  'error_logs_search_empty',
  'cursor_reset_notice',
  'history_evicted',
  'resume_following',
  'level_filter',
  'all_levels',
  'view_request',
  'copy_line',
  'request_log_missing',
  'download_cached',
  'clear_application_confirm',
  'clear_search',
  'reading_enabled',
  'filter_load_more',
] as const;

describe('log interaction translations', () => {
  for (const [locale, document] of Object.entries({ en, zhCN, zhTW, ru })) {
    test(`${locale} includes all new actions, status labels and matching interpolation`, () => {
      for (const key of keys) {
        expect(document.logs[key].trim().length).toBeGreaterThan(0);
        expect(document.logs[key].match(/\{\{\w+\}\}/g) ?? []).toEqual(
          en.logs[key].match(/\{\{\w+\}\}/g) ?? []
        );
      }
    });
  }
});
