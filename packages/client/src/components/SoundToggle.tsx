import { Volume2, VolumeX } from '../ui/Icon.js';

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
      aria-label={enabled ? 'Mute sound' : 'Unmute sound'}
      onClick={onToggle}
      title={enabled ? 'Sound on' : 'Sound off'}
      className="flex h-11 w-11 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
    >
      {enabled ? <Volume2 className="h-5 w-5" aria-hidden="true" /> : <VolumeX className="h-5 w-5" aria-hidden="true" />}
    </button>
  );
}
