import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import {
  createFileRoute,
  Link as RouterLink,
  redirect,
} from "@tanstack/react-router"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { LoginService } from "@/client"
import { AuthLayout } from "@/components/Common/AuthLayout"
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form"
import { isLoggedIn } from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

const formSchema = z.object({ email: z.email() })
type FormData = z.infer<typeof formSchema>

export const Route = createFileRoute("/recover-password")({
  component: RecoverPassword,
  beforeLoad: async () => {
    if (isLoggedIn()) throw redirect({ to: "/" })
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

function RecoverPassword() {
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [btnHover, setBtnHover] = useState(false)

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "" },
  })

  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      await LoginService.recoverPassword({ email: data.email })
    },
    onSuccess: () => {
      showSuccessToast("Password recovery email sent successfully")
      form.reset()
    },
    onError: handleError.bind(showErrorToast),
  })

  const onSubmit = (data: FormData) => {
    if (mutation.isPending) return
    mutation.mutate(data)
  }

  return (
    <AuthLayout
      title="Password recovery"
      subtitle="Enter your work email and we'll send a reset link"
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>

          {/* Email field */}
          <FormField
            control={form.control}
            name="email"
            render={({ field, fieldState }) => (
              <FormItem style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: TEXT2, marginBottom: 6 }}>
                  Work email
                </div>
                <FormControl>
                  <div style={{ position: "relative" }}>
                    <svg
                      viewBox="0 0 24 24"
                      style={{
                        position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
                        width: 15, height: 15, pointerEvents: "none",
                        stroke: fieldState.error ? ERROR : TEXT3,
                        fill: "none", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round",
                      }}
                    >
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                    <input
                      {...field}
                      type="email"
                      placeholder=""
                      autoComplete="email"
                      data-testid="email-input"
                      style={{
                        width: "100%",
                        height: 40,
                        padding: "0 14px 0 40px",
                        background: fieldState.error ? ERROR_BG : BG,
                        border: `1.5px solid ${fieldState.error ? ERROR : BORDER}`,
                        borderRadius: 9,
                        color: TEXT1,
                        fontFamily: "inherit",
                        fontSize: 13.5,
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
                <FormMessage style={{ fontSize: 11.5, color: ERROR, marginTop: 4 }} />
              </FormItem>
            )}
          />

          {/* Submit */}
          <button
            type="submit"
            disabled={mutation.isPending}
            onMouseEnter={() => setBtnHover(true)}
            onMouseLeave={() => setBtnHover(false)}
            style={{
              width: "100%",
              height: 44,
              background: btnHover ? PRIMARY_HOVER : PRIMARY,
              border: "none",
              borderRadius: 10,
              color: "#fff",
              fontFamily: "inherit",
              fontSize: 14,
              fontWeight: 600,
              cursor: mutation.isPending ? "not-allowed" : "pointer",
              letterSpacing: "0.005em",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              boxShadow: "0 1px 2px rgba(0,0,0,0.1), 0 4px 14px rgba(1,106,201,0.3)",
              transition: "background .18s",
              opacity: mutation.isPending ? 0.8 : 1,
            }}
          >
            {mutation.isPending ? (
              <div style={{ width: 18, height: 18, border: "2px solid rgba(255,255,255,0.25)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin .65s linear infinite" }} />
            ) : (
              <>
                <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, stroke: "currentColor", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
                Send reset link
              </>
            )}
          </button>

          {/* Back to sign in */}
          <div style={{ marginTop: 18, textAlign: "center" }}>
            <span style={{ fontSize: 13, color: TEXT3 }}>Remember your password?{" "}</span>
            <RouterLink
              to="/login"
              style={{ fontSize: 13, color: PRIMARY, fontWeight: 500, textDecoration: "none" }}
            >
              Sign in
            </RouterLink>
          </div>

          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </form>
      </Form>
    </AuthLayout>
  )
}
