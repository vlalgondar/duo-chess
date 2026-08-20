import { LogOut } from './Icon.js';
import { Button } from './Button.js';

/**
 * §5.7's `leave`: frees the seat entirely and returns to Home — distinct from a disconnect
 * (closing the tab), which keeps the seat reserved for §9 reconnection. Moved here from
 * `screens/Lobby.tsx` (its original, accidental home) since `TeamSelect` and `ResultScreen`
 * both import it too.
 */
export function LeaveButton({ onLeave }: { onLeave: () => void }) {
  return (
    <Button
      data-testid="leave-button"
      type="button"
      variant="secondary"
      onClick={onLeave}
      className="w-64"
    >
      <LogOut className="h-4 w-4" aria-hidden="true" />
      Leave room
    </Button>
  );
}
