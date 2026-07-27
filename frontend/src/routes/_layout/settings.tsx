import { createFileRoute } from "@tanstack/react-router"
import { ChevronRight, Home } from "lucide-react"

import ChangePassword from "@/components/UserSettings/ChangePassword"
import DeleteAccount from "@/components/UserSettings/DeleteAccount"
import UserInformation from "@/components/UserSettings/UserInformation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import useAuth from "@/hooks/useAuth"

const tabsConfig = [
  { value: "my-profile", title: "My profile", component: UserInformation },
  { value: "password", title: "Password", component: ChangePassword },
  { value: "danger-zone", title: "Danger zone", component: DeleteAccount },
]

export const Route = createFileRoute("/_layout/settings")({
  component: UserSettings,
})

function UserSettings() {
  const { user: currentUser } = useAuth()
  const finalTabs = currentUser?.is_superuser
    ? tabsConfig.slice(0, 3)
    : tabsConfig

  if (!currentUser) {
    return null
  }

  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-14 pt-7 sm:px-6 lg:px-7">
      <div className="mb-5">
        <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Home className="h-3 w-3" />
          <span>Home</span>
          <ChevronRight className="h-3 w-3 opacity-45" />
          <span>Settings</span>
        </div>
        <h1 className="text-[21px] font-semibold tracking-tight text-foreground">
          User Settings
        </h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Manage your account settings and preferences
        </p>
      </div>

      <div
        className="rounded-[13px] border bg-card p-6"
        style={{ boxShadow: "0 1px 3px rgba(14,21,32,0.07)" }}
      >
        <Tabs defaultValue="my-profile">
          <TabsList>
            {finalTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.title}
              </TabsTrigger>
            ))}
          </TabsList>
          {finalTabs.map((tab) => (
            <TabsContent key={tab.value} value={tab.value} className="mt-6">
              <tab.component />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  )
}
