interface SoundToggleProps {
  enabled: boolean;
  onToggle: () => void;
}

/** T-27: "Sounds (mutable...)" — the mutability, as a plain toggle button. */
export function SoundToggle({ enabled, onToggle }: SoundToggleProps) {
  return (
    <button
      type="button"
      data-testid="sound-toggle"
      aria-pressed={enabled}
      onClick={onToggle}
      title={enabled ? 'Sound on' : 'Sound off'}
      className="rounded px-2 py-1 text-sm text-slate-400 hover:text-slate-100"
    >
      {enabled ? '🔊' : '🔇'}
    </button>
  );
}
