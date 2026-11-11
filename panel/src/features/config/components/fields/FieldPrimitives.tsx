import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconAlertTriangle } from '@/components/ui/icons';
import { hasFieldError, isFieldDirty, useConfigFieldState } from '../../fieldState';
import { RESTART_REQUIRED_FIELD_IDS, configFieldDomId } from '../../searchIndex';
import styles from './Field.module.scss';

/** 搜索跳转的脉冲高亮 class（useFieldJump 命令式挂载/移除）。 */
export const FIELD_HIGHLIGHT_CLASS: string = styles.fieldHighlightActive;

/**
 * 表单控件宿主 class：收编旧 VisualConfigEditor 的 :global(.form-group/.input/...)
 * 覆盖的作用域根。SectionCard 的内容区自动挂载；脱离卡片渲染表单块（如 Modal 内容）时手动挂。
 */
export const FIELDS_ROOT_CLASS: string = styles.fieldsRoot;

export type ToggleRowProps = {
  title: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  /** danger：琥珀左规线 + 后果行，用于会放宽安全边界的开关。 */
  variant?: 'default' | 'danger';
  /** 打开后的后果（danger 行必填的一句话）。 */
  consequence?: string;
  /** 依赖项未启用时的说明（finding 8：「Requires X」），与 disabled 一起传。 */
  requiresNote?: string;
};

/**
 * 开关行：点击标题/描述也能切换（ToggleSwitch 自身已是 <label>，不能再嵌套 label）。
 * 紧凑密度（min-height 52px），移动端开关仍右对齐。
 */
export function ToggleRow({
  title,
  description,
  checked,
  disabled,
  onChange,
  variant = 'default',
  consequence,
  requiresNote,
}: ToggleRowProps) {
  const className = [
    styles.toggleRow,
    variant === 'danger' ? styles.toggleRowDanger : '',
    disabled ? styles.toggleRowDisabled : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={className} data-variant={variant}>
      <span
        className={styles.toggleCopy}
        onClick={disabled ? undefined : () => onChange(!checked)}
      >
        <span className={styles.toggleTitle}>{title}</span>
        {description ? <span className={styles.toggleDescription}>{description}</span> : null}
        {consequence ? (
          <span className={styles.toggleConsequence}>
            <IconAlertTriangle size={12} aria-hidden="true" />
            {consequence}
          </span>
        ) : null}
        {requiresNote ? <span className={styles.toggleRequires}>{requiresNote}</span> : null}
      </span>
      <span className={styles.toggleControl}>
        <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} ariaLabel={title} />
      </span>
    </div>
  );
}

export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className={styles.fieldGrid}>{children}</div>;
}

export function FieldStack({ children }: { children: ReactNode }) {
  return <div className={styles.fieldStack}>{children}</div>;
}

export function Divider() {
  return <div className={styles.divider} />;
}

/**
 * Stable anchor around a searchable field. Search jumps target its DOM id (searchIndex.ts) and
 * the highlight pulse is applied to it imperatively. It also reads the page field state:
 * - dirty → amber left rule + "Changed · Reset" meta row (finding 7);
 * - restart-required → "Restart required" pill (finding 4);
 * - validation error → red left rule.
 * `wide` 让字段在 FieldGrid 里跨两列（如长文本的代理 URL）。
 */
export function FieldAnchor({
  fieldId,
  wide = false,
  children,
}: {
  fieldId: string;
  wide?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { dirtyFields, validationErrors, resetField } = useConfigFieldState();
  const dirty = isFieldDirty(fieldId, dirtyFields);
  const invalid = hasFieldError(fieldId, validationErrors);
  const restart = RESTART_REQUIRED_FIELD_IDS.has(fieldId);
  const className = [
    styles.fieldAnchor,
    wide ? styles.fieldAnchorWide : '',
    dirty ? styles.fieldAnchorDirty : '',
    invalid ? styles.fieldAnchorInvalid : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div id={configFieldDomId(fieldId)} className={className} data-dirty={dirty || undefined}>
      {restart || dirty ? (
        <div className={styles.fieldMeta}>
          {restart ? (
            <span className={styles.restartPill}>
              {t('config_management.visual.field_state.restart_required')}
            </span>
          ) : null}
          {dirty ? (
            <span className={styles.dirtyMeta}>
              <span className={styles.dirtyLabel}>
                {t('config_management.visual.field_state.changed')}
              </span>
              {resetField ? (
                <button
                  type="button"
                  className={styles.resetButton}
                  onClick={() => resetField(fieldId)}
                >
                  {t('config_management.visual.field_state.reset')}
                </button>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** 带描边容器的字段组（原 SectionSubsection / .subsection）。title 可省略只留容器。 */
export function FieldGroup({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.group}>
      {title ? (
        <div className={styles.groupHeader}>
          <h3 className={styles.groupTitle}>{title}</h3>
          {description ? <p className={styles.groupDescription}>{description}</p> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** 独立的小组标题行（如 Claude / Codex 请求头小节标题）。 */
export function FieldGroupHeading({ title }: { title: string }) {
  return (
    <div className={styles.groupHeader}>
      <h3 className={styles.groupTitle}>{title}</h3>
    </div>
  );
}

export function FieldShell({
  label,
  labelId,
  htmlFor,
  hint,
  hintId,
  error,
  errorId,
  children,
}: {
  label: string;
  labelId?: string;
  htmlFor?: string;
  hint?: ReactNode;
  hintId?: string;
  error?: string;
  errorId?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.fieldShell}>
      <label id={labelId} htmlFor={htmlFor} className={styles.fieldLabel}>
        {label}
      </label>
      {children}
      {hint ? (
        <div id={hintId} className={styles.fieldHint}>
          {hint}
        </div>
      ) : null}
      {error ? (
        <div id={errorId} className="error-box" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

/** 独立的字段提示行（FieldShell 之外的裸 hint）。 */
export function FieldHint({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <div id={id} className={styles.fieldHint}>
      {children}
    </div>
  );
}

/** 非开关字段的琥珀后果/警告行（与 ToggleRow 的 consequence 同配方）。 */
export function ConsequenceNote({ children, alert = false }: { children: ReactNode; alert?: boolean }) {
  return (
    <span className={styles.toggleConsequence} role={alert ? 'alert' : undefined}>
      <IconAlertTriangle size={12} aria-hidden="true" />
      {children}
    </span>
  );
}

/** 字段提示里的 YAML 键名（单独一行 mono）。 */
export function YamlKey({ path }: { path: string }) {
  return <code className={styles.yamlKey}>{path}</code>;
}

/** Select 控件下方：当前选中项的一句话说明（finding 1）。 */
export function OptionDescription({ children }: { children: ReactNode }) {
  return <div className={styles.optionDescription}>{children}</div>;
}

/** 数字输入右侧的「已禁用」pill 宿主（流式 keepalive 的 0/空 提示）。 */
export function FieldControl({ children }: { children: ReactNode }) {
  return <div className={styles.fieldControl}>{children}</div>;
}

/** FieldControl 内的内联 pill。 */
export function InlinePill({ children }: { children: ReactNode }) {
  return <span className={styles.inlinePill}>{children}</span>;
}

/** Input.rightElement 用的静态单位/状态后缀（如 "s"、"MB"、Disabled pill）。 */
export function FieldSuffix({ children, pill = false }: { children: ReactNode; pill?: boolean }) {
  return (
    <span className={pill ? styles.suffixPill : styles.suffix} aria-hidden="true">
      {children}
    </span>
  );
}
