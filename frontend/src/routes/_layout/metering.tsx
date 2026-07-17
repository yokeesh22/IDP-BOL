import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Loader2 } from "lucide-react"
import { useEffect } from "react"

import { Metering } from "@/components/Metering/Metering"
import useAuth from "@/hooks/useAuth"

export const Route = createFileRoute("/_layout/metering")({
  component: MeteringPage,
})

function MeteringPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  // Metering is superuser-only. Redirect anyone else back to the dashboard once
  // the current user has loaded.
  useEffect(() => {
    if (user && !user.is_superuser) {
      navigate({ to: "/dashboard" })
    }
  }, [user, navigate])

  if (!user) {
    return (
      <div className="mx-auto flex max-w-[1300px] items-center justify-center px-7 py-32">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading…</span>
      </div>
    )
  }

  if (!user.is_superuser) return null

  return <Metering />
}
