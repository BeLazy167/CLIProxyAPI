import { useTranslation } from 'react-i18next';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import type { ConfigEditorMode } from '../constants';
import styles from './ModeSwitch.module.scss';

export type ModeSwitchProps = {
  mode: ConfigEditorMode;
  disabled?: boolean;
  onChange: (mode: ConfigEditorMode) => void;
};

/**
 * 可视化 / 源码 segmented 切换。源码模式是整份文档的另一种表示（不是第 9 个分区），
 * 所以它不进 tabs，常驻 tabs 行右端（移动端上移到头部动作行）。
 */
export function ModeSwitch({ mode, disabled = false, onChange }: ModeSwitchProps) {
  const { t } = useTranslation();

  return (
    <SegmentedControl
      className={styles.segmented}
      itemClassName={styles.segment}
      ariaLabel={t('config_management.mode.label')}
      disabled={disabled}
      value={mode}
      onChange={onChange}
      options={[
        { value: 'visual', label: t('config_management.mode.visual') },
        { value: 'source', label: t('config_management.mode.source') },
      ]}
    />
  );
}
