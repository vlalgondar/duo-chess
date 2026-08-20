import type { HTMLAttributes } from 'react';

/** A bordered, elevated surface — the one card treatment every panel in the app now shares. */
export function Panel({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-xl border border-line bg-surface ${className}`} {...rest} />;
}
