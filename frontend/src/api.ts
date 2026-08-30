// Single source of truth for the backend's base URL, derived from the token endpoint so
// there's only one env var to configure (VITE_TOKEN_ENDPOINT). In dev this resolves to
// "/api", which vite.config.ts proxies to the local Express backend.
export const TOKEN_ENDPOINT = import.meta.env.VITE_TOKEN_ENDPOINT || "/api/getToken";
export const API_BASE = TOKEN_ENDPOINT.replace(/\/getToken$/, "");
