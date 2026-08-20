/**
 * §9's client reconnect loop: "a visible 'Reconnecting…' banner." Rendered
 * above whichever screen is currently showing (`view` stays populated with
 * the last known room state through a reconnect attempt — see `store.ts`'s
 * `ConnectionStatus` doc comment), rather than bouncing the player back to
 * Home while the socket retries in the background.
 */
export function ReconnectBanner() {
  return (
    <div
      data-testid="reconnect-banner"
      role="status"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-warning px-4 py-2 text-sm font-medium text-white"
    >
      <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
      Reconnecting…
    </div>
  );
}
