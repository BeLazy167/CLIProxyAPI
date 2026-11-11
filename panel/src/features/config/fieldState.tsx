// 字段级页面状态的只读上下文：脏字段、校验错误、单字段重置。
// FieldAnchor / ConfigCollapsible 由此推导琥珀脏规线、「已更改 · 重置」、折叠组徽章与自动展开。
// 默认值为空集合，分区在无 Provider 下渲染（测试）行为与原先一致。

import { createContext, useContext } from 'react';
import type { VisualConfigValidationErrors } from '@/types/visualConfig';
import { FIELD_VALUE_KEYS } from './constants';

export type ConfigFieldState = {
  /** useVisualConfig 的脏叶值键集合。 */
  dirtyFields: ReadonlySet<string>;
  validationErrors: VisualConfigValidationErrors | undefined;
  /** 把一个字段恢复到基线值；未提供时字段不显示重置动作。 */
  resetField?: (fieldId: string) => void;
};

const EMPTY: ConfigFieldState = { dirtyFields: new Set(), validationErrors: undefined };

export const ConfigFieldStateContext = createContext<ConfigFieldState>(EMPTY);

export function useConfigFieldState() {
  return useContext(ConfigFieldStateContext);
}

export function isFieldDirty(fieldId: string, dirtyFields: ReadonlySet<string>): boolean {
  return (FIELD_VALUE_KEYS[fieldId] ?? []).some((key) => dirtyFields.has(key));
}

export function hasFieldError(
  fieldId: string,
  validationErrors: VisualConfigValidationErrors | undefined
): boolean {
  if (!validationErrors) return false;
  return (FIELD_VALUE_KEYS[fieldId] ?? []).some((key) =>
    Boolean(validationErrors[key as keyof VisualConfigValidationErrors])
  );
}

/** 一组字段里脏的个数（折叠组徽章「N changed」）。 */
export function countDirtyFields(
  fieldIds: readonly string[],
  dirtyFields: ReadonlySet<string>
): number {
  return fieldIds.reduce((total, id) => total + (isFieldDirty(id, dirtyFields) ? 1 : 0), 0);
}
