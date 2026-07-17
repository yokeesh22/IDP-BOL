import { zodResolver } from "@hookform/resolvers/zod"
import {
  createFileRoute,
  Link as RouterLink,
  redirect,
} from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import type { Body_login_login_access_token as AccessToken } from "@/client"
import { AuthLayout } from "@/components/Common/AuthLayout"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form"
import useAuth, { isLoggedIn } from "@/hooks/useAuth"
import { startSsoLogin, trySsoLogin } from "@/lib/sso"

const formSchema = z.object({
  username: z.email(),
  password: z
    .string()
    .min(1, { message: "Password is required" })
    .min(8, { message: "Password must be at least 8 characters" }),
}) satisfies z.ZodType<AccessToken>

type FormData = z.infer<typeof formSchema>

export const Route = createFileRoute("/login")({
  component: Login,
  beforeLoad: async () => {
    if (isLoggedIn()) {
      throw redirect({ to: "/" })
    }
    // If the user already has an Azure SSO (Easy Auth) session, silently
    // exchange it for an app token and skip the password form entirely.
    const result = await trySsoLogin()
    if (result === "ok") {
      throw redirect({ to: "/" })
    }
    if (result === "forbidden") {
      // Signed in with Microsoft, but not provisioned in this app. Remember so
      // the component can show a clear message instead of a silent failure.
      sessionStorage.setItem("sso_denied", "1")
    }
  },
})

const PRIMARY = "#016ac9"
const PRIMARY_HOVER = "#0158aa"
const BG = "#f0f4f8"
const BORDER = "#e2e8f0"
const TEXT1 = "#0e1a2b"
const TEXT2 = "#4a5a6e"
const TEXT3 = "#8a9aae"
const ERROR = "#dc2626"
const ERROR_BG = "#fef2f2"
const NOT_AUTHORIZED_DESC =
  "Your Microsoft account isn't authorized for this app. Please contact an administrator."

function Login() {
  const { loginMutation } = useAuth()
  const [showPwd, setShowPwd] = useState(false)
  const [btnHover, setBtnHover] = useState(false)
  const [ssoBusy, setSsoBusy] = useState(false)

  useEffect(() => {
    // beforeLoad sets this one-shot flag when the signed-in Microsoft account
    // has no authorized app account; surface it as an amber warning toast.
    if (sessionStorage.getItem("sso_denied") === "1") {
      sessionStorage.removeItem("sso_denied")
      toast.warning("Not authorized", { description: NOT_AUTHORIZED_DESC })
    }
  }, [])

  const onSso = async () => {
    if (ssoBusy) return
    setSsoBusy(true)
    const result = await trySsoLogin()
    if (result === "ok") {
      window.location.href = "/"
      return
    }
    if (result === "forbidden") {
      toast.warning("Not authorized", { description: NOT_AUTHORIZED_DESC })
      setSsoBusy(false)
      return
    }
    // No Microsoft session yet (or a transient error) — start the SSO login.
    startSsoLogin()
  }

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: { username: "", password: "" },
  })

  const onSubmit = (data: FormData) => {
    if (loginMutation.isPending) return
    loginMutation.mutate(data)
  }

  const hasError = !!loginMutation.error

  return (
    <AuthLayout
      title="Sign in to your account"
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          {/* Error banner */}
          {hasError && (
            <div
              style={{
                background: ERROR_BG,
                border: `1px solid rgba(220,38,38,0.2)`,
                borderRadius: 9,
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                gap: 9,
                fontSize: 13,
                color: ERROR,
                marginBottom: 18,
              }}
            >
              <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, stroke: "currentColor", fill: "none", strokeWidth: 2, strokeLinecap: "round", flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              Invalid email or password. Please try again.
            </div>
          )}

          {/* Email */}
          <FormField
            control={form.control}
            name="username"
            render={({ field, fieldState }) => (
              <FormItem style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12.5, fontWeight: 500, color: TEXT2, marginBottom: 7 }}>
                  <span>Work email</span>
                </div>
                <FormControl>
                  <div style={{ position: "relative" }}>
                    <svg className="input-icon" viewBox="0 0 24 24" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, pointerEvents: "none", stroke: fieldState.error ? ERROR : TEXT3, fill: "none", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}>
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                    <input
                      {...field}
                      type="email"
                      placeholder=""
                      autoComplete="email"
                      style={{
                        width: "100%",
                        height: 40,
                        padding: "0 14px 0 40px",
                        background: fieldState.error ? ERROR_BG : BG,
                        border: `1.5px solid ${fieldState.error ? ERROR : BORDER}`,
                        borderRadius: 9,
                        color: TEXT1,
                        fontFamily: "inherit",
                        fontSize: 14,
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = PRIMARY
                        e.currentTarget.style.background = "#fff"
                        e.currentTarget.style.boxShadow = "0 0 0 3px rgba(1,106,201,0.1)"
                      }}
                      onBlur={(e) => {
                        field.onBlur()
                        e.currentTarget.style.borderColor = fieldState.error ? ERROR : BORDER
                        e.currentTarget.style.background = fieldState.error ? ERROR_BG : BG
                        e.currentTarget.style.boxShadow = "none"
                      }}
                    />
                  </div>
                </FormControl>
                <FormMessage style={{ fontSize: 12, color: ERROR, display: "flex", alignItems: "center", gap: 5, marginTop: 5 }} />
              </FormItem>
            )}
          />

          {/* Password */}
          <FormField
            control={form.control}
            name="password"
            render={({ field, fieldState }) => (
              <FormItem style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12.5, fontWeight: 500, color: TEXT2, marginBottom: 7 }}>
                  <span>Password</span>
                  <RouterLink
                    to="/recover-password"
                    style={{ fontSize: 12, color: PRIMARY, textDecoration: "none", fontWeight: 400 }}
                  >
                    Forgot password?
                  </RouterLink>
                </div>
                <FormControl>
                  <div style={{ position: "relative" }}>
                    <svg viewBox="0 0 24 24" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, pointerEvents: "none", stroke: fieldState.error ? ERROR : TEXT3, fill: "none", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}>
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    <input
                      {...field}
                      type={showPwd ? "text" : "password"}
                      placeholder=""
                      autoComplete="current-password"
                      style={{
                        width: "100%",
                        height: 40,
                        padding: "0 44px 0 40px",
                        background: fieldState.error ? ERROR_BG : BG,
                        border: `1.5px solid ${fieldState.error ? ERROR : BORDER}`,
                        borderRadius: 9,
                        color: TEXT1,
                        fontFamily: "inherit",
                        fontSize: 14,
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = PRIMARY
                        e.currentTarget.style.background = "#fff"
                        e.currentTarget.style.boxShadow = "0 0 0 3px rgba(1,106,201,0.1)"
                      }}
                      onBlur={(e) => {
                        field.onBlur()
                        e.currentTarget.style.borderColor = fieldState.error ? ERROR : BORDER
                        e.currentTarget.style.background = fieldState.error ? ERROR_BG : BG
                        e.currentTarget.style.boxShadow = "none"
                      }}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPwd((v) => !v)}
                      style={{
                        position: "absolute",
                        right: 11,
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: 5,
                        color: TEXT3,
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      {showPwd ? (
                        <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, stroke: "currentColor", fill: "none", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}>
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, stroke: "currentColor", fill: "none", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}>
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </FormControl>
                <FormMessage style={{ fontSize: 12, color: ERROR, display: "flex", alignItems: "center", gap: 5, marginTop: 5 }} />
              </FormItem>
            )}
          />

          {/* Submit button */}
          <button
            type="submit"
            disabled={loginMutation.isPending}
            onMouseEnter={() => setBtnHover(true)}
            onMouseLeave={() => setBtnHover(false)}
            style={{
              marginTop: 16,
              width: "100%",
              height: 46,
              background: btnHover ? PRIMARY_HOVER : PRIMARY,
              border: "none",
              borderRadius: 10,
              color: "#fff",
              fontFamily: "inherit",
              fontSize: 14.5,
              fontWeight: 600,
              cursor: loginMutation.isPending ? "not-allowed" : "pointer",
              letterSpacing: "0.005em",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              position: "relative",
              overflow: "hidden",
              boxShadow: "0 1px 2px rgba(0,0,0,0.1), 0 4px 14px rgba(1,106,201,0.3)",
              transition: "background .18s, box-shadow .18s",
              marginBottom: 0,
              opacity: loginMutation.isPending ? 0.8 : 1,
            }}
          >
            {loginMutation.isPending ? (
              <div
                style={{
                  width: 20,
                  height: 20,
                  border: "2px solid rgba(255,255,255,0.25)",
                  borderTopColor: "#fff",
                  borderRadius: "50%",
                  animation: "spin .65s linear infinite",
                }}
              />
            ) : (
              <>
                <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, flexShrink: 0, stroke: "currentColor", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                  <polyline points="10 17 15 12 10 7" />
                  <line x1="15" y1="12" x2="3" y2="12" />
                </svg>
                Sign in
              </>
            )}
          </button>

          {/* Sign in with SSO */}
          <div style={{ marginTop: 20, textAlign: "center" }}>
            <button
              type="button"
              onClick={onSso}
              disabled={ssoBusy}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                fontFamily: "inherit",
                fontSize: 13,
                fontWeight: 500,
                color: PRIMARY,
                cursor: ssoBusy ? "not-allowed" : "pointer",
                opacity: ssoBusy ? 0.7 : 1,
              }}
            >
              {ssoBusy ? "Signing in…" : "Sign in with SSO"}
            </button>
          </div>

          <style>{`
            @keyframes spin { to { transform: rotate(360deg); } }
          `}</style>
        </form>
      </Form>
    </AuthLayout>
  )
}
