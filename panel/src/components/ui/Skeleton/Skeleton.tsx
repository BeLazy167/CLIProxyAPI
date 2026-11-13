import type { CSSProperties, HTMLAttributes } from 'react';
import styles from './Skeleton.module.scss';

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: number | string;
  height?: number | string;
}

export function Skeleton({ width, height, className, style, ...rest }: SkeletonProps) {
  const merged: CSSProperties = {
    ...style,
    width: width ?? style?.width,
    height: height ?? style?.height,
  };
  const cls = [styles.skeleton, className].filter(Boolean).join(' ');
  return <div className={cls} style={merged} aria-hidden="true" {...rest} />;
}
