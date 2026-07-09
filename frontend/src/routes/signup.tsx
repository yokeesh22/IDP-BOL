import { zodResolver } from "@hookform/resolvers/zod"
import {
  createFileRoute,
  Link as RouterLink,
  redirect,
} from "@tanstack/react-router"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { AuthLayout } from "@/components/Common/AuthLayout"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form"
import useAuth, { isLoggedIn } from "@/hooks/useAuth"

const formSchema = z
  .object({
    email: z.email(),
    full_name: z.string().min(1, { message: "Full Name is required" }),
    password: z
      .string()
      .min(1, { message: "Password is required" })
      .min(8, { message: "Password must be at least 8 characters" }),
    confirm_password: z
      .string()
      .min(1, { message: "Password confirmation is required" }),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: "The passwords don't match",
    path: ["confirm_password"],
  })

type FormData = z.infer<typeof formSchema>

export const Route = createFileRoute("/signup")({
  component: SignUp,
  beforeLoad: async () => {
    if (isLoggedIn()) {
      throw redirect({ to: "/" })
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

function FieldInput({
  field,
  fieldState,
  type = "text",
  placeholder,
  autoComplete,
  icon,
  rightSlot,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: react-hook-form field
  field: any
  // biome-ignore lint/suspicious/noExplicitAny: react-hook-form fieldState
  fieldState: any
  type?: string
  placeholder: string
  autoComplete?: string
  icon: React.ReactNode
  rightSlot?: React.ReactNode
}) {
  return (
    <div style={{ position: "relative" }}>
      <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", display: "flex", alignItems: "center" }}>
        {icon}
      </span>
      <input
        {...field}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        style={{
          width: "100%",
          height: 40,
          padding: rightSlot ? "0 44px 0 40px" : "0 14px 0 40px",
          background: fieldState.error ? ERROR_BG : BG,
          border: `1.5px solid ${fieldState.error ? ERROR : BORDER}`,
          borderRadius: 9,
          color: TEXT1,
          fontFamily: "inherit",
          fontSize: 13.5,
          outline: "none",
          boxSizing: "border-box",
        }}
        onFocus={(e: React.FocusEvent<HTMLInputElement>) => {
          e.currentTarget.style.borderColor = PRIMARY
          e.currentTarget.style.background = "#fff"
          e.currentTarget.style.boxShadow = "0 0 0 3px rgba(1,106,201,0.1)"
        }}
        onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
          field.onBlur()
          e.currentTarget.style.borderColor = fieldState.error ? ERROR : BORDER
          e.currentTarget.style.background = fieldState.error ? ERROR_BG : BG
          e.currentTarget.style.boxShadow = "none"
        }}
      />
      {rightSlot}
    </div>
  )
}

function SignUp() {
  const { signUpMutation } = useAuth()
  const [showPwd, setShowPwd] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [btnHover, setBtnHover] = useState(false)

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: { email: "", full_name: "", password: "", confirm_password: "" },
  })

  const onSubmit = (data: FormData) => {
    if (signUpMutation.isPending) return
    const { confirm_password: _confirm_password, ...submitData } = data
    signUpMutation.mutate(submitData)
  }

  const iconStyle = (error: boolean): React.CSSProperties => ({
    width: 15,
    height: 15,
    stroke: error ? ERROR : TEXT3,
    fill: "none",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  })

  const eyeBtn = (show: boolean, toggle: () => void) => (
    <button
      type="button"
      tabIndex={-1}
      onClick={toggle}
      style={{ position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 4, color: TEXT3, display: "flex", alignItems: "center" }}
    >
      {show ? (
        <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, stroke: "currentColor", fill: "none", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, stroke: "currentColor", fill: "none", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
    </button>
  )

  return (
    <AuthLayout title="Create your account">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>

          {/* Full name */}
          <FormField
            control={form.control}
            name="full_name"
            render={({ field, fieldState }) => (
              <FormItem style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: TEXT2, marginBottom: 6 }}>Full name</div>
                <FormControl>
                  <FieldInput
                    field={field}
                    fieldState={fieldState}
                    placeholder=""
                    autoComplete="name"
                    icon={
                      <svg viewBox="0 0 24 24" style={iconStyle(!!fieldState.error)}>
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    }
                  />
                </FormControl>
                <FormMessage style={{ fontSize: 11.5, color: ERROR, marginTop: 4 }} />
              </FormItem>
            )}
          />

          {/* Email */}
          <FormField
            control={form.control}
            name="email"
            render={({ field, fieldState }) => (
              <FormItem style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: TEXT2, marginBottom: 6 }}>Work email</div>
                <FormControl>
                  <FieldInput
                    field={field}
                    fieldState={fieldState}
                    type="email"
                    placeholder=""
                    autoComplete="email"
                    icon={
                      <svg viewBox="0 0 24 24" style={iconStyle(!!fieldState.error)}>
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                        <polyline points="22,6 12,13 2,6" />
                      </svg>
                    }
                  />
                </FormControl>
                <FormMessage style={{ fontSize: 11.5, color: ERROR, marginTop: 4 }} />
              </FormItem>
            )}
          />

          {/* Password */}
          <FormField
            control={form.control}
            name="password"
            render={({ field, fieldState }) => (
              <FormItem style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: TEXT2, marginBottom: 6 }}>Password</div>
                <FormControl>
                  <FieldInput
                    field={field}
                    fieldState={fieldState}
                    type={showPwd ? "text" : "password"}
                    placeholder=""
                    autoComplete="new-password"
                    icon={
                      <svg viewBox="0 0 24 24" style={iconStyle(!!fieldState.error)}>
                        <rect x="3" y="11" width="18" height="11" rx="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    }
                    rightSlot={eyeBtn(showPwd, () => setShowPwd((v) => !v))}
                  />
                </FormControl>
                <FormMessage style={{ fontSize: 11.5, color: ERROR, marginTop: 4 }} />
              </FormItem>
            )}
          />

          {/* Confirm password */}
          <FormField
            control={form.control}
            name="confirm_password"
            render={({ field, fieldState }) => (
              <FormItem style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: TEXT2, marginBottom: 6 }}>Confirm password</div>
                <FormControl>
                  <FieldInput
                    field={field}
                    fieldState={fieldState}
                    type={showConfirm ? "text" : "password"}
                    placeholder=""
                    autoComplete="new-password"
                    icon={
                      <svg viewBox="0 0 24 24" style={iconStyle(!!fieldState.error)}>
                        <rect x="3" y="11" width="18" height="11" rx="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    }
                    rightSlot={eyeBtn(showConfirm, () => setShowConfirm((v) => !v))}
                  />
                </FormControl>
                <FormMessage style={{ fontSize: 11.5, color: ERROR, marginTop: 4 }} />
              </FormItem>
            )}
          />

          {/* Submit */}
          <button
            type="submit"
            disabled={signUpMutation.isPending}
            onMouseEnter={() => setBtnHover(true)}
            onMouseLeave={() => setBtnHover(false)}
            style={{
              marginTop: 16,
              width: "100%",
              height: 44,
              background: btnHover ? PRIMARY_HOVER : PRIMARY,
              border: "none",
              borderRadius: 10,
              color: "#fff",
              fontFamily: "inherit",
              fontSize: 14,
              fontWeight: 600,
              cursor: signUpMutation.isPending ? "not-allowed" : "pointer",
              letterSpacing: "0.005em",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              boxShadow: "0 1px 2px rgba(0,0,0,0.1), 0 4px 14px rgba(1,106,201,0.3)",
              transition: "background .18s",
              opacity: signUpMutation.isPending ? 0.8 : 1,
            }}
          >
            {signUpMutation.isPending ? (
              <div style={{ width: 18, height: 18, border: "2px solid rgba(255,255,255,0.25)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin .65s linear infinite" }} />
            ) : (
              <>
                <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, stroke: "currentColor", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <line x1="19" y1="8" x2="19" y2="14" />
                  <line x1="22" y1="11" x2="16" y2="11" />
                </svg>
                Create account
              </>
            )}
          </button>

          {/* Sign in link */}
          <div style={{ marginTop: 18, textAlign: "center" }}>
            <span style={{ fontSize: 13, color: TEXT3 }}>Already have an account?{" "}</span>
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

export default SignUp
