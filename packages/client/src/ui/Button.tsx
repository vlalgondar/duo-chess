import { forwardRef, type ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'link';
type Size = 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-hi disabled:opacity-50',
  secondary: 'bg-surface-2 text-text hover:bg-line-strong disabled:opacity-40',
  danger: 'bg-danger text-white hover:bg-danger-hi disabled:opacity-40',
  ghost: 'bg-transparent text-text border border-line hover:bg-surface-2 disabled:opacity-40',
  link: 'bg-transparent text-accent underline underline-offset-2 hover:text-accent/80 disabled:opacity-40',
};

const SIZE_CLASS: Record<Size, string> = {
  md: 'h-11 min-w-[44px] px-4 text-sm',
  lg: 'h-12 min-w-[48px] px-5 text-base',
};

/**
 * Shared button primitive replacing the two `BUTTON_BASE` constants that used to disagree
 * (`TeamPanel.tsx` was `h-12`/48px, `VoteActions.tsx` was `h-11`/44px) — `md` and `lg` both
 * clear CLAUDE.md rule 9's 44px minimum, so every call site keeps its tap-target size.
 * Always spreads `...rest` last so `data-testid`, `aria-*`, `title`, and `disabled` reach the DOM.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className = '', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors ${SIZE_CLASS[size]} ${VARIANT_CLASS[variant]} ${className}`}
      {...rest}
    />
  );
});
