import { useId, type InputHTMLAttributes } from 'react';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

/** A real `<label>` + input pair — Home's inputs used to be placeholder-only with no label at all. */
export function Field({ label, hint, id, className = '', ...rest }: FieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-text-muted">
        {label}
      </label>
      <input
        id={inputId}
        className={`h-11 rounded-lg border border-line bg-surface-2 px-3 text-text placeholder:text-text-dim ${className}`}
        {...rest}
      />
      {hint && <p className="text-xs text-text-dim">{hint}</p>}
    </div>
  );
}
