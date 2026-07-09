import { createFileRoute } from "@tanstack/react-router"

import { DocumentList } from "@/components/Documents/DocumentList"

export const Route = createFileRoute("/_layout/documents/")({
  component: DocumentsPage,
})

function DocumentsPage() {
  return <DocumentList />
}
