import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/ui/Collapsible';
import { countDirtyFields, hasFieldError, useConfigFieldState } from '../fieldState';

type ConfigCollapsibleProps = Omit<
  ComponentProps<typeof Collapsible>,
  'badge' | 'hasError' | 'forceOpen'
> & {
  /** 折叠组内渲染的字段 id；用于推导「N changed」徽章、错误圆点与自动展开。 */
  fieldIds: readonly string[];
  /** 额外的自动展开条件（如远程管理密钥缺失的警告）。 */
  attention?: boolean;
};

/**
 * 配置页专用的 Collapsible：从字段状态上下文推导摘要行徽章与自动展开。
 * 子字段有校验错误 / 被修改 / 需要注意时展开一次；用户仍可收起。
 */
export function ConfigCollapsible({ fieldIds, attention = false, ...rest }: ConfigCollapsibleProps) {
  const { t } = useTranslation();
  const { dirtyFields, validationErrors } = useConfigFieldState();
  const dirtyCount = countDirtyFields(fieldIds, dirtyFields);
  const hasError = fieldIds.some((id) => hasFieldError(id, validationErrors));
  return (
    <Collapsible
      {...rest}
      hasError={hasError}
      badge={
        dirtyCount > 0
          ? t('config_management.visual.field_state.changed_count', { count: dirtyCount })
          : undefined
      }
      forceOpen={hasError || dirtyCount > 0 || attention}
    />
  );
}
