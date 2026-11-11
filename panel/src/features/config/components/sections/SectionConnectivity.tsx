import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input';
import { IconEye, IconEyeOff } from '@/components/ui/icons';
import { useNotificationStore } from '@/stores';
import { CONFIG_TAB_ICONS, SECTION_INDEX_LABELS } from '../../constants';
import type { ConfigSectionProps } from '../../types';
import { hasRemoteKeyWarning } from '../../uiState';
import { SectionCard } from '../SectionCard';
import { ConfigCollapsible } from '../ConfigCollapsible';
import {
  ConsequenceNote,
  Divider,
  FieldAnchor,
  FieldGrid,
  FieldGroup,
  FieldShell,
  FieldStack,
  ToggleRow,
  YamlKey,
} from '../fields/FieldPrimitives';
import { ApiKeysField, HostField, PortField } from '../fields/sharedFields';
import { getValidationMessage } from '../blocks/shared';
import { StringListEditor } from '../blocks/StringListEditor';
import { SectionDiscovery } from './SectionDiscovery';
import styles from '../fields/Field.module.scss';

const Icon = CONFIG_TAB_ICONS.connectivity;
const S = 'config_management.visual.sections';
const TLS_FIELD_IDS = ['tlsEnable', 'tlsCert', 'tlsKey'];
const REMOTE_FIELD_IDS = [
  'rmAllowRemote',
  'rmDisableControlPanel',
  'rmDisableAutoUpdatePanel',
  'rmSecretKey',
  'rmPanelRepo',
];

/** 01 接入与认证：监听地址 / 认证 / 反向代理 + TLS / 远程管理 / 局域网发现折叠组。 */
export function SectionConnectivity({
  values,
  validationErrors,
  disabled,
  animateIn,
  onChange,
}: ConfigSectionProps) {
  const { t } = useTranslation();
  const id = useId();
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [showSecret, setShowSecret] = useState(false);
  const trustedProxiesError = getValidationMessage(t, validationErrors?.trustedProxies);
  const portError = getValidationMessage(t, validationErrors?.port);
  const remoteKeyWarning = hasRemoteKeyWarning(values);

  const handleAllowRemoteChange = (rmAllowRemote: boolean) => {
    if (!rmAllowRemote) {
      onChange({ rmAllowRemote });
      return;
    }
    showConfirmation({
      title: t(`${S}.remote.allow_remote_confirm_title`),
      message: t(`${S}.remote.allow_remote_confirm_message`),
      confirmText: t(`${S}.remote.allow_remote_confirm_action`),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: () => onChange({ rmAllowRemote: true }),
    });
  };

  return (
    <SectionCard
      indexLabel={SECTION_INDEX_LABELS.connectivity}
      icon={<Icon size={16} />}
      title={t(`${S}.connectivity.title`)}
      description={t(`${S}.connectivity.description`)}
      animateIn={animateIn}
    >
      <FieldStack>
        <FieldGroup title={t(`${S}.connectivity.group_listener`)}>
          <FieldGrid>
            <HostField values={values} disabled={disabled} onChange={onChange} />
            <PortField values={values} disabled={disabled} onChange={onChange} error={portError} />
          </FieldGrid>
        </FieldGroup>

        <FieldGroup title={t(`${S}.connectivity.group_auth`)}>
          <FieldStack>
            <FieldAnchor fieldId="authDir">
              <Input
                label={t(`${S}.auth.auth_dir`)}
                placeholder="~/.cli-proxy-api"
                value={values.authDir}
                onChange={(e) => onChange({ authDir: e.target.value })}
                disabled={disabled}
                hint={
                  <>
                    {t(`${S}.auth.auth_dir_hint`)}
                    <YamlKey path="oauth.auth-dir" />
                  </>
                }
              />
            </FieldAnchor>
            <ApiKeysField values={values} disabled={disabled} onChange={onChange} />
          </FieldStack>
        </FieldGroup>

        <FieldGroup title={t(`${S}.connectivity.group_proxy`)}>
          <FieldAnchor fieldId="trustedProxies">
            <FieldShell
              label={t('config_management.visual.serverExtras.trustedProxies.label')}
              labelId={`${id}-trustedProxies-label`}
              hintId={`${id}-trustedProxies-hint`}
              hint={
                <>
                  <ConsequenceNote>
                    {t('config_management.visual.serverExtras.trustedProxies.consequence')}
                  </ConsequenceNote>
                  <br />
                  {t('config_management.visual.serverExtras.trustedProxies.hint')}
                  <YamlKey path="server.trusted-proxies" />
                </>
              }
              error={trustedProxiesError}
              errorId={`${id}-trustedProxies-error`}
            >
              <div
                role="group"
                aria-labelledby={`${id}-trustedProxies-label`}
                aria-describedby={`${id}-trustedProxies-hint${trustedProxiesError ? ` ${id}-trustedProxies-error` : ''}`}
                aria-invalid={Boolean(trustedProxiesError)}
              >
                <StringListEditor
                  value={values.trustedProxies}
                  disabled={disabled}
                  placeholder="192.168.0.0/24"
                  inputAriaLabel={t('config_management.visual.serverExtras.trustedProxies.label')}
                  onChange={(trustedProxies) => onChange({ trustedProxies })}
                />
              </div>
            </FieldShell>
          </FieldAnchor>
        </FieldGroup>

        <ConfigCollapsible
          label={t(`${S}.tls.title`)}
          hint={t(`${S}.tls.description`)}
          defaultOpen={false}
          fieldIds={TLS_FIELD_IDS}
        >
          <FieldStack>
            <FieldAnchor fieldId="tlsEnable">
              <ToggleRow
                title={t(`${S}.tls.enable`)}
                description={t(`${S}.tls.enable_desc`)}
                checked={values.tlsEnable}
                disabled={disabled}
                onChange={(tlsEnable) => onChange({ tlsEnable })}
              />
            </FieldAnchor>

            {values.tlsEnable ? (
              <>
                <Divider />
                <FieldGrid>
                  <FieldAnchor fieldId="tlsCert">
                    <Input
                      label={t(`${S}.tls.cert`)}
                      placeholder="/path/to/cert.pem"
                      value={values.tlsCert}
                      onChange={(e) => onChange({ tlsCert: e.target.value })}
                      disabled={disabled}
                      hint={
                        <>
                          {t(`${S}.tls.cert_hint`)}
                          <YamlKey path="server.tls.cert" />
                        </>
                      }
                    />
                  </FieldAnchor>
                  <FieldAnchor fieldId="tlsKey">
                    <Input
                      label={t(`${S}.tls.key`)}
                      placeholder="/path/to/key.pem"
                      value={values.tlsKey}
                      onChange={(e) => onChange({ tlsKey: e.target.value })}
                      disabled={disabled}
                      hint={
                        <>
                          {t(`${S}.tls.key_hint`)}
                          <YamlKey path="server.tls.key" />
                        </>
                      }
                    />
                  </FieldAnchor>
                </FieldGrid>
              </>
            ) : null}
          </FieldStack>
        </ConfigCollapsible>

        <ConfigCollapsible
          label={t(`${S}.remote.title`)}
          hint={t(`${S}.remote.description`)}
          defaultOpen={false}
          fieldIds={REMOTE_FIELD_IDS}
          attention={remoteKeyWarning}
        >
          <FieldStack>
            <FieldGrid>
              <FieldAnchor fieldId="rmAllowRemote">
                <ToggleRow
                  variant="danger"
                  title={t(`${S}.remote.allow_remote`)}
                  description={t(`${S}.remote.allow_remote_desc`)}
                  consequence={t(`${S}.remote.allow_remote_consequence`)}
                  checked={values.rmAllowRemote}
                  disabled={disabled}
                  onChange={handleAllowRemoteChange}
                />
              </FieldAnchor>
              <FieldAnchor fieldId="rmDisableControlPanel">
                <ToggleRow
                  title={t(`${S}.remote.disable_panel`)}
                  description={t(`${S}.remote.disable_panel_desc`)}
                  checked={values.rmDisableControlPanel}
                  disabled={disabled}
                  onChange={(rmDisableControlPanel) => onChange({ rmDisableControlPanel })}
                />
              </FieldAnchor>
              <FieldAnchor fieldId="rmDisableAutoUpdatePanel">
                <ToggleRow
                  title={t(`${S}.remote.disable_auto_update_panel`)}
                  description={t(`${S}.remote.disable_auto_update_panel_desc`)}
                  checked={values.rmDisableAutoUpdatePanel}
                  disabled={disabled}
                  onChange={(rmDisableAutoUpdatePanel) => onChange({ rmDisableAutoUpdatePanel })}
                />
              </FieldAnchor>
            </FieldGrid>
            <FieldGrid>
              <FieldAnchor fieldId="rmSecretKey">
                <Input
                  label={t(`${S}.remote.secret_key`)}
                  type={showSecret ? 'text' : 'password'}
                  autoComplete="off"
                  placeholder={t(`${S}.remote.secret_key_placeholder`)}
                  value={values.rmSecretKey}
                  onChange={(e) => onChange({ rmSecretKey: e.target.value })}
                  disabled={disabled}
                  rightElement={
                    <button
                      type="button"
                      className={styles.revealButton}
                      disabled={disabled}
                      onClick={() => setShowSecret((v) => !v)}
                      aria-label={t(
                        showSecret ? `${S}.remote.secret_key_hide` : `${S}.remote.secret_key_show`
                      )}
                      aria-pressed={showSecret}
                    >
                      {showSecret ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                    </button>
                  }
                  hint={
                    <>
                      {remoteKeyWarning ? (
                        <>
                          <ConsequenceNote alert>
                            {t(`${S}.remote.secret_key_missing_warning`)}
                          </ConsequenceNote>
                          <br />
                        </>
                      ) : null}
                      {t(`${S}.remote.secret_key_hint`)}
                      <YamlKey path="management.secret-key" />
                    </>
                  }
                />
              </FieldAnchor>
              <FieldAnchor fieldId="rmPanelRepo">
                <Input
                  label={t(`${S}.remote.panel_repo`)}
                  placeholder="https://github.com/router-for-me/Cli-Proxy-API-Management-Center"
                  value={values.rmPanelRepo}
                  onChange={(e) => onChange({ rmPanelRepo: e.target.value })}
                  disabled={disabled}
                  hint={
                    <>
                      {t(`${S}.remote.panel_repo_hint`)}
                      <YamlKey path="management.panel-github-repository" />
                    </>
                  }
                />
              </FieldAnchor>
            </FieldGrid>
          </FieldStack>
        </ConfigCollapsible>
        <SectionDiscovery
          values={values}
          validationErrors={validationErrors}
          disabled={disabled}
          onChange={onChange}
        />
      </FieldStack>
    </SectionCard>
  );
}
