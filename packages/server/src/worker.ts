import { RoomDO } from './RoomDO.js';

export { RoomDO };

function isAllowedOrigin(origin: string | null, allowedOrigins: string): boolean {
  if (!origin) return false;
  const allowed = allowedOrigins.split(',').map((o) => o.trim());
  return allowed.includes(origin);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const match = /^\/ws\/([^/]+)$/.exec(url.pathname);
    if (!match) {
      return new Response('Not found', { status: 404 });
    }

    if (!isAllowedOrigin(request.headers.get('Origin'), env.ALLOWED_ORIGINS)) {
      return new Response('Forbidden origin', { status: 403 });
    }

    const code = match[1] as string;
    const id = env.ROOMS.idFromName(code);
    const stub = env.ROOMS.get(id);
    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;
