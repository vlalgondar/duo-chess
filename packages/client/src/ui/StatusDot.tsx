interface StatusDotProps {
  connected: boolean;
  className?: string;
}

/** The connected/disconnected dot — was three near-identical inline spans across Lobby, TeamSelect, and Spectators. */
export function StatusDot({ connected, className = '' }: StatusDotProps) {
  return (
    <span
      data-testid="connection-dot"
      data-connected={connected}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${connected ? 'bg-primary' : 'bg-surface-2'} ${className}`}
    />
  );
}
