import { initBackend, astroAdapter } from '../../lib/backend';

initBackend();

export const ALL = astroAdapter.handle();
export const prerender = false;
