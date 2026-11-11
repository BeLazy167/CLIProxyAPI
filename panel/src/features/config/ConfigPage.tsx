import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { Skeleton } from '@/components/ui/Skeleton';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useRevealGroup } from '@/hooks/motion';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useVisualConfig } from '@/hooks/useVisualConfig';
import { useAuthStore, useNotificationStore, useThemeStore } from '@/stores';
import type { VisualConfigValues } from '@/types/visualConfig';
import {
  CONFIG_MODE_STORAGE_KEY,
  CONFIG_SECTION_STORAGE_KEY,
  FIELD_VALUE_KEYS,
  LEGACY_EDITOR_MODE_STORAGE_KEY,
  configPanelDomId,
  configTabDomId,
  type ConfigEditorMode,
  type ConfigTabId,
} from './constants';
import {
  buildChangeList,
  buildHeaderMeta,
  countSectionErrors,
  countTotalErrors,
  findFirstErrorField,
  hasRemoteKeyWarning,
  readSavedMode,
  readSavedSection,
  resolveDirtyTabs,
  resolveRestartRequiredDirtyFields,
  resolveStatus,
  summarizeDirtySections,
} from './uiState';
import { ConfigFieldStateContext, type ConfigFieldState } from './fieldState';
import { findConfigFieldById } from './searchIndex';
import { shouldReloadVisualDraft, useConfigDocument } from './hooks/useConfigDocument';
import { useFieldJump } from './hooks/useFieldJump';
import { useSourceSearch } from './hooks/useSourceSearch';
import { ConfigHeader } from './components/ConfigHeader';
import { ConfigSearch } from './components/ConfigSearch';
import { ConfigTabs } from './components/ConfigTabs';
import { DiffModal } from './components/DiffModal';
import { FloatingSaveBar } from './components/FloatingSaveBar';
import { ModeSwitch } from './components/ModeSwitch';
import { SourcePanel, SourceSearchBar } from './components/SourcePanel';
import { SectionAdvanced } from './components/sections/SectionAdvanced';
import { SectionCommon } from './components/sections/SectionCommon';
import { SectionConnectivity } from './components/sections/SectionConnectivity';
import { SectionLogging } from './components/sections/SectionLogging';
import { SectionNetwork } from './components/sections/SectionNetwork';
import { SectionPayload } from './components/sections/SectionPayload';
import { SectionQuota } from './components/sections/SectionQuota';
import { SectionStreaming } from './components/sections/SectionStreaming';
import styles from './ConfigPage.module.scss';

/** 首载入场预算：卡片延迟 0.28s + 0.45s 动画，之后关闭 animateIn，切 tab 不再重播。 */
const ENTRANCE_BUDGET_MS = 800;
const SEARCH_INPUT_ID = 'config-field-search';

/** `/` 快捷键：焦点在可输入控件里时不抢。 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function ConfigPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const requestedFieldEntry = useMemo(() => {
    const fieldId = new URLSearchParams(location.search).get('field');
    return findConfigFieldById(fieldId);
  }, [location.search]);
  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.isCurrentLayer : true;
  const showNotification = useNotificationStore((state) => state.showNotification);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const revealRef = useRevealGroup<HTMLDivElement>();

  const {
    visualValues,
    visualDirty,
    visualDirtyFields,
    visualParseError,
    visualValidationErrors,
    visualHasPayloadValidationErrors,
    loadVisualValuesFromYaml,
    rebaseVisualValuesFromYaml,
    applyVisualChangesToYaml,
    setVisualValues,
  } = useVisualConfig();

  const [mode, setMode] = useState<ConfigEditorMode>(() =>
    requestedFieldEntry ? 'visual' : readSavedMode(localStorage.getItem(CONFIG_MODE_STORAGE_KEY))
  );
  const [activeSection, setActiveSection] = useState<ConfigTabId>(
    () =>
      requestedFieldEntry?.sectionId ??
      readSavedSection(localStorage.getItem(CONFIG_SECTION_STORAGE_KEY))
  );
  const handledRequestedFieldRef = useRef<string | null>(null);
  // 首载入场：挂载后一个预算周期内为 true；此后切 tab 新挂载的卡片不再播入场。
  const [animateCards, setAnimateCards] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setAnimateCards(false), ENTRANCE_BUDGET_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // 旧「简单/完整」双模式已退役，清掉遗留的持久化键。
  useEffect(() => {
    localStorage.removeItem(LEGACY_EDITOR_MODE_STORAGE_KEY);
  }, []);

  const doc = useConfigDocument({
    mode,
    visualDirty,
    visualParseError,
    loadVisualValuesFromYaml,
    rebaseVisualValuesFromYaml,
    applyVisualChangesToYaml,
  });
  const sourceSearch = useSourceSearch();

  const disableControls = connectionStatus !== 'connected';
  const hasVisualModeError = !!visualParseError;
  const hasVisualValidationErrors =
    mode === 'visual' &&
    (Object.values(visualValidationErrors).some(Boolean) || visualHasPayloadValidationErrors);

  // 基线快照：useVisualConfig 不暴露基线；脏集合为空时当前值即基线（渲染期调整状态）。
  // 供「已更改 · 重置」与审阅变更列表（旧 → 新）使用。
  const [baseline, setBaseline] = useState<VisualConfigValues>(visualValues);
  if (visualDirtyFields.size === 0 && baseline !== visualValues) setBaseline(visualValues);

  const resetField = useCallback(
    (fieldId: string) => {
      const patch: Partial<VisualConfigValues> = {};
      let streaming: VisualConfigValues['streaming'] | null = null;
      for (const key of FIELD_VALUE_KEYS[fieldId] ?? []) {
        if (key.startsWith('streaming.')) {
          const leaf = key.slice('streaming.'.length) as keyof VisualConfigValues['streaming'];
          streaming = { ...(streaming ?? visualValues.streaming), [leaf]: baseline.streaming[leaf] };
        } else {
          const topKey = key as keyof VisualConfigValues;
          (patch as Record<string, unknown>)[topKey] = baseline[topKey];
        }
      }
      if (streaming) patch.streaming = streaming;
      setVisualValues(patch);
    },
    [baseline, setVisualValues, visualValues.streaming]
  );

  const fieldState = useMemo<ConfigFieldState>(
    () => ({
      dirtyFields: visualDirtyFields,
      validationErrors: visualValidationErrors,
      resetField,
    }),
    [resetField, visualDirtyFields, visualValidationErrors]
  );

  const unsavedChangesDialog = useMemo(
    () => ({
      title: t('common.unsaved_changes_title'),
      message: t('common.unsaved_changes_message'),
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
    }),
    [t]
  );

  useUnsavedChangesGuard({
    enabled: isCurrentLayer,
    shouldBlock: doc.isDirty,
    dialog: unsavedChangesDialog,
  });

  // YAML 解析失败：切换到源码模式；修复后仍可重试进入可视化模式。
  useEffect(() => {
    if (mode !== 'visual' || !visualParseError) return;

    setMode('source');
    localStorage.setItem(CONFIG_MODE_STORAGE_KEY, 'source');
    showNotification(
      t('config_management.visual_mode_unavailable_detail', { message: visualParseError }),
      'error'
    );
  }, [mode, showNotification, t, visualParseError]);

  // 可视化 ↔ 源码切换的 dirty 交接：
  // → 源码：物化可视化脏字段供查看，但不把同步动作记作用户源码编辑；
  // → 可视化：源码草稿必须先保存或放弃；纯查看源码往返保留字段级 dirty。
  const handleModeChange = useCallback(
    (nextMode: ConfigEditorMode) => {
      if (nextMode === mode) return;
      if (nextMode === 'visual' && doc.sourceDirty) {
        showNotification(t('config_management.source_changes_before_visual'), 'warning');
        return;
      }

      if (nextMode === 'source') {
        if (visualDirty) {
          // content may be an earlier local source preview, not a server readback.
          const nextContent = applyVisualChangesToYaml(doc.content, 'draft');
          if (nextContent !== doc.content) {
            doc.syncContentFromVisual(nextContent);
          }
        }
      } else if (shouldReloadVisualDraft(doc.sourceDirty, visualParseError)) {
        const result = loadVisualValuesFromYaml(doc.content);
        if (!result.ok) {
          showNotification(
            t('config_management.visual_mode_unavailable_detail', { message: result.error }),
            'error'
          );
          return;
        }
      }

      setMode(nextMode);
      localStorage.setItem(CONFIG_MODE_STORAGE_KEY, nextMode);
    },
    [
      applyVisualChangesToYaml,
      doc,
      loadVisualValuesFromYaml,
      mode,
      showNotification,
      t,
      visualDirty,
      visualParseError,
    ]
  );

  const handleSectionChange = useCallback((sectionId: ConfigTabId) => {
    setActiveSection(sectionId);
    localStorage.setItem(CONFIG_SECTION_STORAGE_KEY, sectionId);
  }, []);

  const { jumpToField } = useFieldJump({
    values: visualValues,
    setActiveSection: handleSectionChange,
  });

  useEffect(() => {
    if (!requestedFieldEntry || handledRequestedFieldRef.current === requestedFieldEntry.fieldId) {
      return;
    }

    handledRequestedFieldRef.current = requestedFieldEntry.fieldId;
    localStorage.setItem(CONFIG_MODE_STORAGE_KEY, 'visual');
    jumpToField(requestedFieldEntry);

    const nextSearchParams = new URLSearchParams(location.search);
    nextSearchParams.delete('field');
    const nextSearch = nextSearchParams.toString();
    void navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
        hash: location.hash,
      },
      { replace: true }
    );
  }, [
    jumpToField,
    location.hash,
    location.pathname,
    location.search,
    navigate,
    requestedFieldEntry,
  ]);

  const errorCounts = useMemo(
    () => countSectionErrors(visualValidationErrors, visualHasPayloadValidationErrors),
    [visualHasPayloadValidationErrors, visualValidationErrors]
  );
  const dirtyTabs = useMemo(() => resolveDirtyTabs(visualDirtyFields), [visualDirtyFields]);
  const totalErrors = useMemo(
    () => countTotalErrors(visualValidationErrors, visualHasPayloadValidationErrors),
    [visualHasPayloadValidationErrors, visualValidationErrors]
  );
  const warningTabs = useMemo<ReadonlySet<ConfigTabId>>(
    () => new Set(hasRemoteKeyWarning(visualValues) ? (['connectivity'] as const) : []),
    [visualValues]
  );

  const status = resolveStatus({
    disconnected: disableControls,
    loading: doc.loading,
    loadFailed: Boolean(doc.error),
    yamlError: hasVisualModeError,
    validationBlocked: hasVisualValidationErrors,
    saving: doc.saving,
    dirty: doc.isDirty,
  });
  const headerMeta = buildHeaderMeta({
    status,
    dirtyCount: visualDirtyFields.size,
    sourceDirty: doc.sourceDirty,
    errorCount: mode === 'visual' ? totalErrors : 0,
  });

  const saveDisabled =
    disableControls ||
    doc.loading ||
    doc.saving ||
    !doc.isDirty ||
    doc.diffModalOpen ||
    hasVisualModeError ||
    hasVisualValidationErrors;

  // 保存栏第二行：「Network 2, Logging 1」。
  const dirtySummaryText = useMemo(() => {
    if (mode !== 'visual' || visualDirtyFields.size === 0) return undefined;
    return summarizeDirtySections(visualDirtyFields)
      .map(
        ({ sectionId, count }) =>
          `${t(`config_management.visual.sections.${sectionId}.title`)} ${count}`
      )
      .join(', ');
  }, [mode, t, visualDirtyFields]);

  const handleFixErrors = useCallback(() => {
    const entry = findFirstErrorField(visualValidationErrors, visualHasPayloadValidationErrors);
    if (entry) jumpToField(entry);
  }, [jumpToField, visualHasPayloadValidationErrors, visualValidationErrors]);

  const changeList = useMemo(
    () =>
      doc.diffModalOpen && mode === 'visual'
        ? buildChangeList(visualDirtyFields, baseline, visualValues, t)
        : [],
    [baseline, doc.diffModalOpen, mode, t, visualDirtyFields, visualValues]
  );

  // Finding 4：保存了需重启的字段后，显示持续的琥珀通知（直到页面重载）。
  // 保存开始时快照需重启的脏字段；保存结束且不再 dirty 即视为成功。
  const [restartNotice, setRestartNotice] = useState<string[]>([]);
  const pendingRestartRef = useRef<string[]>([]);
  const wasSavingRef = useRef(false);
  useEffect(() => {
    if (doc.saving && !wasSavingRef.current) {
      pendingRestartRef.current = resolveRestartRequiredDirtyFields(visualDirtyFields);
    } else if (!doc.saving && wasSavingRef.current) {
      if (!doc.isDirty && pendingRestartRef.current.length > 0) {
        const saved = pendingRestartRef.current;
        setRestartNotice((prev) => Array.from(new Set([...prev, ...saved])));
      }
      pendingRestartRef.current = [];
    }
    wasSavingRef.current = doc.saving;
  }, [doc.isDirty, doc.saving, visualDirtyFields]);
  const restartNoticeText = useMemo(() => {
    if (restartNotice.length === 0) return undefined;
    const labels = restartNotice
      .map((fieldId) => findConfigFieldById(fieldId))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .map((entry) => t(entry.labelKey))
      .join(', ');
    return t('config_management.restart_notice', { fields: labels });
  }, [restartNotice, t]);

  // Finding 21：Ctrl/Cmd+S 打开审阅；`/` 聚焦字段搜索。
  useEffect(() => {
    if (!isCurrentLayer) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (doc.isDirty && !saveDisabled) void doc.handleSave();
        return;
      }
      if (
        event.key === '/' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        mode === 'visual' &&
        !isTypingTarget(event.target)
      ) {
        const input = document.getElementById(SEARCH_INPUT_ID);
        if (input instanceof HTMLInputElement && !input.disabled) {
          event.preventDefault();
          input.focus();
          input.select();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [doc, isCurrentLayer, mode, saveDisabled]);

  const sectionProps = {
    values: visualValues,
    validationErrors: visualValidationErrors,
    disabled:
      disableControls || doc.loading || doc.saving || doc.diffModalOpen || doc.recoveryRequired,
    animateIn: animateCards,
    onChange: setVisualValues,
  };

  const renderActiveSection = () => {
    switch (activeSection) {
      case 'common':
        return <SectionCommon {...sectionProps} onOpenSection={handleSectionChange} />;
      case 'connectivity':
        return <SectionConnectivity {...sectionProps} />;
      case 'network':
        return <SectionNetwork {...sectionProps} />;
      case 'logging':
        return <SectionLogging {...sectionProps} />;
      case 'quota':
        return <SectionQuota {...sectionProps} />;
      case 'streaming':
        return <SectionStreaming {...sectionProps} />;
      case 'advanced':
        return <SectionAdvanced {...sectionProps} />;
      case 'payload':
        return (
          <SectionPayload
            {...sectionProps}
            hasPayloadValidationErrors={visualHasPayloadValidationErrors}
          />
        );
    }
  };

  // 显式状态：未连接 → 空态；首载中 → 骨架；加载失败 → 可重试横幅；否则编辑器。
  const showSkeleton = doc.loading && !doc.content;
  const renderBody = () => {
    if (disableControls) {
      return (
        <EmptyState
          title={t('config_management.status_disconnected_short')}
          description={t('config_management.status_disconnected')}
        />
      );
    }
    if (showSkeleton) {
      return (
        <div className={styles.skeletonStack} aria-busy="true">
          <Skeleton height={44} rounded={12} />
          <Skeleton height={220} rounded={14} />
          <Skeleton height={160} rounded={14} />
        </div>
      );
    }
    if (doc.error && !doc.content) return null;
    return (
      <>
        <div className={styles.chrome} data-reveal>
          <div className={styles.toolbar}>
            {mode === 'visual' ? (
              <ConfigSearch
                inputId={SEARCH_INPUT_ID}
                disabled={disableControls || doc.loading}
                onJump={jumpToField}
                values={visualValues}
              />
            ) : (
              <SourceSearchBar search={sourceSearch} disabled={disableControls || doc.loading} />
            )}
            <ModeSwitch
              mode={mode}
              disabled={doc.saving || doc.loading || doc.diffModalOpen || doc.recoveryRequired}
              onChange={handleModeChange}
            />
          </div>
          {mode === 'visual' ? (
            <div className={styles.tabsRow}>
              <ConfigTabs
                active={activeSection}
                errorCounts={errorCounts}
                dirtyTabs={dirtyTabs}
                warningTabs={warningTabs}
                disabled={doc.saving || doc.loading}
                onChange={handleSectionChange}
              />
            </div>
          ) : null}
        </div>

        {mode === 'visual' ? (
          <div
            className={styles.panel}
            role="tabpanel"
            id={configPanelDomId(activeSection)}
            aria-labelledby={configTabDomId(activeSection)}
          >
            {renderActiveSection()}
          </div>
        ) : (
          <SourcePanel
            search={sourceSearch}
            value={doc.content}
            onChange={doc.handleChange}
            theme={resolvedTheme}
            editable={!disableControls && !doc.loading && !doc.saving && !doc.diffModalOpen}
          />
        )}
      </>
    );
  };

  return (
    <ConfigFieldStateContext.Provider value={fieldState}>
      <div className={styles.page} ref={revealRef}>
        <ConfigHeader
          meta={headerMeta}
          reloadDisabled={doc.loading || doc.saving}
          reloading={doc.loading}
          onReload={doc.handleReload}
        />

        <ErrorBanner
          message={doc.error}
          onRetry={() => void doc.loadConfig()}
          retrying={doc.loading}
        />
        {!doc.error && visualParseError ? (
          <ErrorBanner
            message={t('config_management.visual_mode_unavailable_detail', {
              message: visualParseError,
            })}
          />
        ) : null}
        {restartNoticeText ? <ErrorBanner tone="warning" message={restartNoticeText} /> : null}

        {renderBody()}

        <FloatingSaveBar
          visible={isCurrentLayer && doc.isDirty}
          statusText={t(
            doc.recoveryRequired
              ? 'config_management.precise_save_recovery_required'
              : isMobile
                ? status.shortLabelKey
                : status.labelKey
          )}
          statusTone={status.tone}
          summaryText={dirtySummaryText}
          errorCount={mode === 'visual' ? totalErrors : 0}
          onFixErrors={handleFixErrors}
          saving={doc.saving}
          saveDisabled={saveDisabled}
          discardDisabled={doc.loading || doc.saving}
          onSave={doc.handleSave}
          onDiscard={doc.handleDiscard}
        />

        <DiffModal
          open={doc.diffModalOpen}
          original={doc.serverYaml}
          modified={doc.mergedYaml}
          changes={changeList}
          onConfirm={doc.handleConfirmSave}
          onCancel={doc.closeDiff}
          loading={doc.saving}
        />
      </div>
    </ConfigFieldStateContext.Provider>
  );
}
