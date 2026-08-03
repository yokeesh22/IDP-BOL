import { Link, useLocation } from "@tanstack/react-router"
import { FileText, Gauge, LayoutDashboard, LogOut, Shield, User as UserIcon } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"

import useAuth from "@/hooks/useAuth"
import { cn } from "@/lib/utils"

interface NavItem {
  title: string
  path: string
  icon: typeof FileText
}

interface TopAppBarProps {
  center?: ReactNode
  hideNav?: boolean
}

export function TopAppBar({ center, hideNav }: TopAppBarProps) {
  const { user, logout } = useAuth()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [])

  const navItems: NavItem[] = [
    { title: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
    { title: "Documents", path: "/documents", icon: FileText },
  ]
  if (user?.is_superuser) {
    navItems.push({ title: "Metering", path: "/metering", icon: Gauge })
    navItems.push({ title: "Admin", path: "/admin", icon: Shield })
  }

  const initials = (user?.full_name || user?.email || "U")
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()

  return (
    <header
      className="sticky top-0 z-40 flex h-14 items-center px-3 sm:px-5"
      style={{
        background: "#ffffff",
        borderBottom: "1px solid #e2e8f0",
        boxShadow: "0 1px 4px rgba(14,26,43,0.06)",
        color: "#0e1a2b",
      }}
    >
      <Link to="/dashboard" className="flex items-center gap-3.5 no-underline">
        <div style={{ height: 28, overflow: "hidden", display: "flex", alignItems: "center" }}>
          <img
            src="/assets/images/sterislogo.png"
            alt="STERIS"
            style={{ height: 42, width: "auto", objectFit: "contain" }}
          />
        </div>
        <div
          className="hidden h-5 w-px flex-shrink-0 lg:block"
          style={{ background: "#e2e8f0" }}
        />
        <span
          className="hidden lg:inline"
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.13em",
            color: "#7488a0",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            userSelect: "none",
          }}
        >
          Document Intelligence
        </span>
      </Link>

      {/* spacer */}
      <div className="flex-1" />

      {hideNav ? (
        <div className="flex items-center mr-3">{center}</div>
      ) : (
        <nav className="flex items-center gap-0.5 mr-3">
          {navItems.map((item) => {
            const active =
              location.pathname === item.path ||
              location.pathname.startsWith(`${item.path}/`)
            const Icon = item.icon
            return (
              <Link
                key={item.path}
                to={item.path}
                title={item.title}
                style={{ display: "flex", alignItems: "center" }}
                className={cn(
                  "gap-1.5 rounded-md px-2.5 py-1.5 text-[13.5px] font-medium leading-none transition-colors sm:px-3.5",
                  active
                    ? "bg-[#eff6ff] text-[#016ac9]"
                    : "text-[#4a5a6e] hover:bg-[#f0f4f8] hover:text-[#0e1a2b]",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" style={{ display: "block" }} />
                <span className="hidden leading-none sm:inline">{item.title}</span>
              </Link>
            )
          })}
        </nav>
      )}

      <div className="flex items-center gap-1.5">
        {/* Notifications — hidden for now (feature not in use)
        <IconBtn label="Notifications">
          <Bell className="h-[19px] w-[19px]" />
          <span
            className="absolute right-2 top-2 h-[7px] w-[7px] rounded-full"
            style={{
              background: "#f59e0b",
              border: "1.5px solid #ffffff",
            }}
          />
        </IconBtn>

        <div
          className="mx-1.5 h-6 w-px"
          style={{ background: "#e2e8f0" }}
        />
        */}

        <div ref={wrapRef} className="relative ml-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setOpen((o) => !o)
            }}
            className="flex h-[34px] w-[34px] select-none items-center justify-center rounded-full border-[1.5px] text-xs font-semibold transition-colors"
            style={{
              background: "#eff6ff",
              borderColor: "#bfdbfe",
              color: "#016ac9",
            }}
            aria-label="Profile"
          >
            {initials}
          </button>

          {open && (
            <div
              className="absolute right-0 top-[calc(100%+9px)] w-[230px] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b px-4 pb-3 pt-3.5">
                <div className="text-[13.5px] font-semibold">
                  {user?.full_name || "User"}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {user?.email}
                </div>
              </div>
              <div className="p-1.5">
                <Link
                  to="/settings"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <UserIcon className="h-[15px] w-[15px]" />
                  User settings
                </Link>
                <div className="my-1 h-px bg-border" />
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    logout()
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-red-600 transition-colors hover:bg-red-50"
                >
                  <LogOut className="h-[15px] w-[15px]" />
                  Log out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

// Used by the notifications button (currently disabled). Kept for when it returns.
// function IconBtn({
//   children,
//   label,
// }: {
//   children: ReactNode
//   label: string
// }) {
//   return (
//     <button
//       type="button"
//       title={label}
//       aria-label={label}
//       className="relative flex h-[34px] w-[34px] items-center justify-center rounded-md text-[#6b7a8d] transition-colors hover:bg-[#f0f4f8] hover:text-[#0e1a2b]"
//     >
//       {children}
//     </button>
//   )
// }

export default TopAppBar
