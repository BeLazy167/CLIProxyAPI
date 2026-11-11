import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { IconEye, IconEyeOff } from '@/components/ui/icons';
import { useAuthStore, useLanguageStore, useNotificationStore } from '@/stores';
import { detectApiBaseFromLocation, normalizeApiBase } from '@/utils/connection';
import { LANGUAGE_LABEL_KEYS, LANGUAGE_ORDER } from '@/utils/constants';
import { isSupportedLanguage } from '@/utils/language';
import { INLINE_LOGO_JPEG } from '@/assets/logoInline';
import { getLocalizedLoginError, type LoginError } from './loginErrors';
import styles from './LoginPage.module.scss';

type RedirectState = { from?: { pathname?: string } };

const MANAGEMENT_KEY_DOCS_URL = 'https://help.router-for.me/';
// Just long enough for the splash to fade; the user should not wait on it.
const AUTO_LOGIN_FADE_MS = 300;

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { showNotification } = useNotificationStore();
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const login = useAuthStore((state) => state.login);
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const storedBase = useAuthStore((state) => state.apiBase);
  const storedKey = useAuthStore((state) => state.managementKey);
  const storedRememberPassword = useAuthStore((state) => state.rememberPassword);

  const [apiBase, setApiBase] = useState('');
  const [managementKey, setManagementKey] = useState('');
  const [editingBase, setEditingBase] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [rememberPassword, setRememberPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [autoLoading, setAutoLoading] = useState(true);
  const [autoLoginSuccess, setAutoLoginSuccess] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [error, setError] = useState<LoginError | null>(null);

  const detectedBase = useMemo(() => detectApiBaseFromLocation(), []);
  const effectiveBase = apiBase.trim() ? normalizeApiBase(apiBase) : detectedBase;
  const languageOptions = useMemo(
    () =>
      LANGUAGE_ORDER.map((lang) => ({
        value: lang,
        label: t(LANGUAGE_LABEL_KEYS[lang]),
      })),
    [t]
  );
  const handleLanguageChange = useCallback(
    (selectedLanguage: string) => {
      if (!isSupportedLanguage(selectedLanguage)) {
        return;
      }
      setLanguage(selectedLanguage);
    },
    [setLanguage]
  );

  useEffect(() => {
    const init = async () => {
      const hadSession = localStorage.getItem('isLoggedIn') === 'true';
      try {
        const autoLoggedIn = await restoreSession();
        if (autoLoggedIn) {
          setAutoLoginSuccess(true);
          setTimeout(() => {
            const redirect = (location.state as RedirectState | null)?.from?.pathname || '/';
            navigate(redirect, { replace: true });
          }, AUTO_LOGIN_FADE_MS);
        } else {
          setApiBase(storedBase || detectedBase);
          setManagementKey(storedKey || '');
          setRememberPassword(storedRememberPassword || Boolean(storedKey));
          // restoreSession swallows the login error; a saved session that did
          // not come back means the attempt failed, not that there was none.
          setRestoreFailed(hadSession && useAuthStore.getState().connectionStatus === 'error');
        }
      } finally {
        // 自动登录成功时 showSplash 仍由 autoLoginSuccess 维持，可无条件结束 loading
        setAutoLoading(false);
      }
    };

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (loading) return;
      if (!managementKey.trim()) {
        setError({ message: t('login.error_required') });
        return;
      }

      setLoading(true);
      setError(null);
      setRestoreFailed(false);
      try {
        await login({
          apiBase: effectiveBase,
          managementKey: managementKey.trim(),
          rememberPassword,
        });
        showNotification(t('common.connected_status'), 'success');
        navigate('/', { replace: true });
      } catch (err: unknown) {
        const loginError = getLocalizedLoginError(err, t);
        setError(loginError);
        if (loginError.connection) setEditingBase(true);
      } finally {
        setLoading(false);
      }
    },
    [effectiveBase, loading, login, managementKey, navigate, rememberPassword, showNotification, t]
  );

  if (isAuthenticated && !autoLoading && !autoLoginSuccess) {
    const redirect = (location.state as RedirectState | null)?.from?.pathname || '/';
    return <Navigate to={redirect} replace />;
  }

  // 显示启动动画（自动登录中或自动登录成功）
  const showSplash = autoLoading || autoLoginSuccess;

  return (
    <div className={styles.container}>
      {/* 左侧品牌展示区 */}
      <div className={styles.brandPanel}>
        <div className={styles.brandContent}>
          <span className={styles.brandWord}>CLI</span>
          <span className={styles.brandWord}>PROXY</span>
          <span className={styles.brandWord}>API</span>
        </div>
      </div>

      {/* 右侧功能交互区 */}
      <div className={styles.formPanel}>
        {showSplash ? (
          /* 启动动画 */
          <div
            className={[styles.splashContent, autoLoginSuccess ? styles.splashExit : '']
              .filter(Boolean)
              .join(' ')}
          >
            <img src={INLINE_LOGO_JPEG} alt="CPAMC" className={styles.splashLogo} />
            <h1 className={styles.splashTitle}>{t('splash.title')}</h1>
            <p className={styles.splashSubtitle}>{t('splash.subtitle')}</p>
            <div className={styles.splashLoader}>
              <div className={styles.splashLoaderBar} />
            </div>
          </div>
        ) : (
          /* 登录表单 */
          <div className={styles.formContent}>
            {/* Logo */}
            <img src={INLINE_LOGO_JPEG} alt="Logo" className={styles.logo} />

            {/* 登录表单卡片 */}
            <form className={styles.loginCard} onSubmit={handleSubmit} noValidate>
              <div className={styles.loginHeader}>
                <div className={styles.titleRow}>
                  <div className={styles.title}>{t('title.login')}</div>
                  <Select
                    className={styles.languageSelect}
                    value={language}
                    options={languageOptions}
                    onChange={handleLanguageChange}
                    fullWidth={false}
                    ariaLabel={t('language.switch')}
                  />
                </div>
                <div className={styles.subtitle}>{t('login.subtitle')}</div>
              </div>

              {restoreFailed && (
                <div className={styles.restoreNote} role="status">
                  {t('login.restore_failed')}
                </div>
              )}

              {editingBase ? (
                <Input
                  autoFocus
                  label={t('login.custom_connection_label')}
                  placeholder={t('login.custom_connection_placeholder')}
                  value={apiBase}
                  name="cpa-api-base"
                  autoComplete="url"
                  inputMode="url"
                  onChange={(e) => {
                    setApiBase(e.target.value);
                    setError(null);
                  }}
                  hint={
                    <span className={styles.connectionPreview}>
                      {t('login.connecting_to')} <code>{effectiveBase}</code>
                    </span>
                  }
                />
              ) : (
                <div className={styles.connectionRow}>
                  <span className={styles.connectionLabel}>{t('login.connecting_to')}</span>
                  <code className={styles.connectionValue}>{effectiveBase}</code>
                  <button
                    type="button"
                    className={styles.connectionChange}
                    onClick={() => setEditingBase(true)}
                  >
                    {t('login.change_connection')}
                  </button>
                </div>
              )}

              <Input
                autoFocus={!editingBase}
                label={t('login.management_key_label')}
                placeholder={t('login.management_key_placeholder')}
                type={showKey ? 'text' : 'password'}
                name="cpa-management-key"
                autoComplete="current-password"
                value={managementKey}
                onChange={(e) => {
                  setManagementKey(e.target.value);
                  setError(null);
                }}
                hint={
                  <>
                    {t('login.management_key_help')}{' '}
                    <a href={MANAGEMENT_KEY_DOCS_URL} target="_blank" rel="noopener noreferrer">
                      {t('login.management_key_docs')}
                    </a>
                  </>
                }
                rightElement={
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowKey((prev) => !prev)}
                    aria-label={showKey ? t('login.hide_key') : t('login.show_key')}
                    title={showKey ? t('login.hide_key') : t('login.show_key')}
                  >
                    {showKey ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                  </button>
                }
              />

              <div className={styles.toggleAdvanced}>
                <SelectionCheckbox
                  checked={rememberPassword}
                  onChange={setRememberPassword}
                  ariaLabel={t('login.remember_password_label')}
                  label={t('login.remember_password_label')}
                  labelClassName={styles.toggleLabel}
                />
              </div>

              {error && (
                <div className={styles.errorBox} role="alert">
                  <div>{error.message}</div>
                  {error.causes && (
                    <ul className={styles.errorCauses}>
                      {error.causes.map((cause) => (
                        <li key={cause}>{cause}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <Button type="submit" fullWidth loading={loading}>
                {loading ? t('login.submitting') : t('login.submit_button')}
              </Button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
