import { createFileRoute } from "@tanstack/react-router"

import { DocumentViewer } from "@/components/Documents/DocumentViewer"

export const Route = createFileRoute("/_layout/documents/$docId")({
  component: DocumentPage,
})

function DocumentPage() {
  const { docId } = Route.useParams()
  return <DocumentViewer docId={docId} />
}
