import axios from "axios"

// When VITE_API_URL is unset we default to a relative path ("") in production
// builds so the frontend calls the API on the same origin (nginx proxies
// /api to the backend). During local `bun run dev` we fall back to localhost.
// Note: `??` (not `||`) so an explicitly empty VITE_API_URL stays relative.
export const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (import.meta.env.PROD ? "" : "http://localhost:8765")
export const API_PREFIX = "/api/v1"

const api = axios.create({
  baseURL: `${API_BASE}${API_PREFIX}`,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token")
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response && [401, 403].includes(err.response.status)) {
      localStorage.removeItem("access_token")
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login"
      }
    }
    return Promise.reject(err)
  },
)

export type DocumentStatus = "pending" | "processing" | "processed" | "error"
export type ReviewStatus = "approved" | "rejected"

export interface BoundingRegion {
  page_number: number
  polygon: number[][]
}

export interface KVField {
  content: string
  bounding_regions: BoundingRegion[]
}

export interface KVPair {
  key: KVField
  value: KVField
  confidence: number
}

export interface TableCell {
  row_index: number
  column_index: number
  row_span: number
  column_span: number
  content: string
  kind: "content" | "columnHeader" | "rowHeader" | "stubHead" | "description"
  bounding_regions: BoundingRegion[]
}

export interface ExtractedTable {
  index: number
  row_count: number
  column_count: number
  bounding_regions: BoundingRegion[]
  cells: TableCell[]
}

export interface DocumentMeta {
  id: string
  version: number
  filename: string
  original_filename: string
  file_size: number
  status: DocumentStatus
  page_count: number
  key_value_pairs: KVPair[]
  tables: ExtractedTable[]
  bol_kv_fields: BolKvField[] | null
  bol_line_items: Record<string, string | null>[] | null
  error_message: string | null
  created_at: string | null
  processed_at: string | null
  review_status: ReviewStatus | null
  review_comment: string | null
  reviewed_at: string | null
  owner_id: string | null
  owner_name: string | null
  owner_email: string | null
}

export interface DocumentDetail extends DocumentMeta {
  page_images: string[]
}

interface DocumentsResponse {
  data: DocumentMeta[]
  count: number
}

export async function fetchDocuments(): Promise<DocumentMeta[]> {
  const { data } = await api.get<DocumentsResponse>("/documents/")
  return data.data
}

export async function fetchDocument(id: string): Promise<DocumentDetail> {
  const { data } = await api.get<DocumentDetail>(`/documents/${id}`)
  return data
}

export async function uploadDocument(file: File): Promise<DocumentMeta> {
  const form = new FormData()
  form.append("file", file)
  const { data } = await api.post<DocumentMeta>("/documents/upload", form)
  return data
}

export async function deleteDocument(id: string): Promise<void> {
  await api.delete(`/documents/${id}`)
}

export async function updateDocumentFields(
  id: string,
  payload: {
    version: number
    key_value_pairs?: KVPair[]
    tables?: ExtractedTable[]
    bol_kv_fields?: BolKvField[]
    bol_line_items?: Record<string, string | null>[]
  },
): Promise<DocumentDetail> {
  const { data } = await api.patch<DocumentDetail>(
    `/documents/${id}/fields`,
    payload,
  )
  return data
}

export async function reviewDocument(
  id: string,
  payload: { review_status: ReviewStatus; review_comment?: string | null },
): Promise<DocumentDetail> {
  const { data } = await api.patch<DocumentDetail>(
    `/documents/${id}/review`,
    payload,
  )
  return data
}

// ── Chat ──────────────────────────────────────────────────────────────────────

export interface ChatSession {
  id: string
  title: string | null
  created_at: string | null
}

export interface ChatMessage {
  id: string
  session_id: string
  role: "user" | "assistant"
  content: string
  created_at: string | null
}

export async function createChatSession(
  documentId?: string,
): Promise<ChatSession> {
  const { data } = await api.post<ChatSession>("/chat/sessions", {
    document_id: documentId ?? null,
  })
  return data
}

export async function listChatSessions(): Promise<ChatSession[]> {
  const { data } = await api.get<ChatSession[]>("/chat/sessions")
  return data
}

export async function listDocumentChatSessions(
  documentId: string,
): Promise<ChatSession[]> {
  const { data } = await api.get<ChatSession[]>(
    `/chat/sessions/document/${documentId}`,
  )
  return data
}

export async function getChatMessages(
  sessionId: string,
): Promise<ChatMessage[]> {
  const { data } = await api.get<ChatMessage[]>(
    `/chat/sessions/${sessionId}/messages`,
  )
  return data
}

export async function sendChatMessage(
  sessionId: string,
  message: string,
): Promise<ChatMessage> {
  const { data } = await api.post<ChatMessage>(
    `/chat/sessions/${sessionId}/messages`,
    { message },
  )
  return data
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  await api.delete(`/chat/sessions/${sessionId}`)
}

// ── BOL Fields of Interest ────────────────────────────────────────────────────

export interface BolKvField {
  label: string
  value: string | null
  found: boolean
  kv_pair_index: number // index into key_value_pairs, -1 if unmatched
  judge_corrected: boolean // true if the judge pass changed this field
}

export interface BolFieldsResponse {
  kv_fields: BolKvField[]
  line_items: Record<string, string | null>[]
}

export async function fetchBolFields(
  docId: string,
): Promise<BolFieldsResponse> {
  const { data } = await api.get<BolFieldsResponse>(
    `/documents/${docId}/bol-fields`,
  )
  return data
}

// ── Metering (superuser only) ─────────────────────────────────────────────────

export interface MeteringRates {
  currency: string
  as_of: string
  doc_intelligence_per_1k_pages: number
  ai_input_per_1m_tokens: number
  ai_output_per_1m_tokens: number
}

export interface MeteringRecord {
  date: string | null
  kind: "document" | "chat"
  label: string
  pages: number
  input_tokens: number
  output_tokens: number
  di_cost: number
  ai_cost: number
  cost: number
}

export interface MeteringSummary {
  rates: MeteringRates
  records: MeteringRecord[]
}

export async function fetchMeteringSummary(): Promise<MeteringSummary> {
  const { data } = await api.get<MeteringSummary>("/metering/summary")
  return data
}

export function getStaticUrl(path: string): string {
  if (!path) return ""
  if (path.startsWith("http")) return path
  return `${API_BASE}${path}`
}
