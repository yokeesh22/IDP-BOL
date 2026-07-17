import { API_BASE, API_PREFIX } from "./api"

// Result of attempting to exchange an Azure SSO (Easy Auth) session for an app
// access token via the backend `/login/sso` endpoint.
//   ok            — a matching app account exists; token stored, user is in.
//   unauthenticated — no Microsoft session yet (kick off the platform login).
//   forbidden     — signed in with Microsoft but no authorized app account.
//   error         — network/other failure (fall back to the password form).
export type SsoResult = "ok" | "unauthenticated" | "forbidden" | "error"

/**
 * Try to log in using the existing Azure Container Apps SSO session.
 *
 * The platform authenticates the user at the ingress and injects their identity
 * into the request headers, so this call needs no credentials of its own — it
 * simply asks the backend to mint an app JWT for the already-signed-in user.
 */
export async function trySsoLogin(): Promise<SsoResult> {
  try {
    const res = await fetch(`${API_BASE}${API_PREFIX}/login/sso`, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    })
    if (res.ok) {
      const data = await res.json().catch(() => null)
      if (data?.access_token) {
        localStorage.setItem("access_token", data.access_token)
        localStorage.setItem("sso_login", "true")
        return "ok"
      }
      return "error"
    }
    if (res.status === 401) return "unauthenticated"
    if (res.status === 403) return "forbidden"
    return "error"
  } catch {
    return "error"
  }
}

/**
 * Kick off the Azure Container Apps built-in (Easy Auth) Microsoft login,
 * returning to the app root afterwards. Used by the "Sign in with SSO" button
 * when there is no active Microsoft session to exchange.
 */
export function startSsoLogin(): void {
  window.location.href = "/.auth/login/aad?post_login_redirect_uri=/"
}

/**
 * Sign out of the Azure SSO session at the platform level. Only meaningful in
 * the deployed Container App; in local dev there is no `/.auth` endpoint.
 */
export function ssoLogout(): void {
  window.location.href = "/.auth/logout?post_logout_redirect_uri=/"
}
