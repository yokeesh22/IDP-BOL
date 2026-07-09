import { createFileRoute } from "@tanstack/react-router"

import { Dashboard } from "@/components/Dashboard/Dashboard"

export const Route = createFileRoute("/_layout/dashboard")({
  component: DashboardPage,
})

function DashboardPage() {
  return <Dashboard />
}
