import { createFileRoute, Outlet, redirect, useLocation } from "@tanstack/react-router"

import { ChatWidget } from "@/components/Chat/ChatWidget"
import { TopAppBar } from "@/components/Common/TopAppBar"
import { isLoggedIn } from "@/hooks/useAuth"

export const Route = createFileRoute("/_layout")({
  component: Layout,
  beforeLoad: async () => {
    if (!isLoggedIn()) {
      throw redirect({
        to: "/login",
      })
    }
  },
})

function Layout() {
  const location = useLocation()
  // Document reviewer screen owns its own appbar (with breadcrumb) and uses
  // the full viewport. Skip rendering the standard appbar/page chrome there.
  const isReviewer = /^\/documents\/[^/]+$/.test(location.pathname)

  if (isReviewer) {
    return <Outlet />
  }

  return (
    <div className="flex min-h-svh flex-col" style={{ background: "#ffffff" }}>
      <TopAppBar />
      <main className="flex-1">
        <Outlet />
      </main>
      <ChatWidget />
    </div>
  )
}

export default Layout
