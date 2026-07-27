import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { ChevronRight, Home } from "lucide-react"
import { Suspense } from "react"

import { type UserPublic, UsersService } from "@/client"
import AddUser from "@/components/Admin/AddUser"
import { columns, type UserTableData } from "@/components/Admin/columns"
import { DataTable } from "@/components/Common/DataTable"
import PendingUsers from "@/components/Pending/PendingUsers"
import useAuth from "@/hooks/useAuth"

function getUsersQueryOptions() {
  return {
    queryFn: () => UsersService.readUsers({ skip: 0, limit: 100 }),
    queryKey: ["users"],
  }
}

export const Route = createFileRoute("/_layout/admin")({
  component: Admin,
  beforeLoad: async () => {
    const user = await UsersService.readUserMe()
    if (!user.is_superuser) {
      throw redirect({
        to: "/",
      })
    }
  },
})

function UsersTableContent() {
  const { user: currentUser } = useAuth()
  const { data: users } = useSuspenseQuery(getUsersQueryOptions())

  const tableData: UserTableData[] = users.data.map((user: UserPublic) => ({
    ...user,
    isCurrentUser: currentUser?.id === user.id,
  }))

  return <DataTable columns={columns} data={tableData} />
}

function UsersTable() {
  return (
    <Suspense fallback={<PendingUsers />}>
      <UsersTableContent />
    </Suspense>
  )
}

function Admin() {
  return (
    <div className="mx-auto max-w-[1300px] px-4 pb-14 pt-7 sm:px-6 lg:px-7">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Home className="h-3 w-3" />
            <span>Home</span>
            <ChevronRight className="h-3 w-3 opacity-45" />
            <span>Admin</span>
          </div>
          <h1 className="text-[21px] font-semibold tracking-tight text-foreground">
            User Management
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Manage user accounts, roles, and permissions
          </p>
        </div>
        <AddUser />
      </div>

      <div
        className="overflow-hidden rounded-[13px] border bg-card"
        style={{ boxShadow: "0 1px 3px rgba(14,21,32,0.07)" }}
      >
        <UsersTable />
      </div>
    </div>
  )
}
