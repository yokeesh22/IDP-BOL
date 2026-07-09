interface AuthLayoutProps {
  children: React.ReactNode
  title?: string
  subtitle?: string
}

export function AuthLayout({
  children,
  title = "Sign in to your account",
  subtitle,
}: AuthLayoutProps) {
  return (
    <div
      className="relative flex min-h-screen items-center justify-center"
      style={{ background: "#fff", fontFamily: "'DM Sans', system-ui, sans-serif" }}
    >

      {/* Card */}
      <div
        className="relative z-10 w-full auth-card-wrapper"
        style={{ maxWidth: 480, margin: "0 auto", padding: "0 16px" }}
      >
        <div
          className="auth-card"
          style={{
            background: "#ffffff",
            /* border: "1px solid #e2e8f0", */
            /* borderRadius: 12, */
            padding: "32px 44px 28px",
            /* boxShadow:
              "0 1px 3px rgba(14,26,43,0.06), 0 8px 32px rgba(14,26,43,0.08), 0 0 0 1px rgba(255,255,255,0.9) inset", */
            animation: "cardIn .5s cubic-bezier(.22,1,.36,1) both",
          }}
        >
          {/* Logo area */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              marginBottom: 20,
              gap: 14,
            }}
          >
            <img
              src="/assets/images/sterislogo.png"
              alt="STERIS"
              style={{ height: 42, width: "auto", objectFit: "contain" }}
            />
            {/* Divider with app name */}
            <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
              <span style={{
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "0.12em",
                color: "#7488a0",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
                userSelect: "none",
              }}>
                Document Intelligence
              </span>
              <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
            </div>
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  fontSize: 19,
                  fontWeight: 600,
                  color: "#0e1a2b",
                  letterSpacing: "-0.02em",
                  marginBottom: subtitle ? 3 : 0,
                }}
              >
                {title}
              </div>
              {subtitle && (
                <div style={{ fontSize: 12.5, color: "#8a9aae" }}>{subtitle}</div>
              )}
            </div>
          </div>

          {children}
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap');
        @keyframes cardIn {
          from { opacity: 0; transform: translateY(16px) scale(0.988); }
          to   { opacity: 1; transform: none; }
        }

        /* Small laptop screens (13–13.5 inch, typically ≤960px wide or ≤720px tall) */
        @media (max-width: 960px), (max-height: 720px) {
          .auth-card-wrapper {
            padding: 0 0px;
          }
          .auth-card {
            border: none !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            padding: 24px 44px 20px !important;
          }
        }

        /* Extra small / mobile */
        @media (max-width: 480px) {
          .auth-card {
            padding: 20px 18px 16px !important;
          }
        }
      `}</style>
    </div>
  )
}
