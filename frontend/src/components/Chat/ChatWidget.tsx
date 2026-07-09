import { MessageCircle, Plus, Send, Trash2, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { MarkdownMessage } from "./MarkdownMessage"

import {
  type ChatMessage,
  type ChatSession,
  createChatSession,
  deleteChatSession,
  getChatMessages,
  listChatSessions,
  sendChatMessage,
} from "@/lib/api"

export function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [showSessions, setShowSessions] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) loadSessions()
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  async function loadSessions() {
    try {
      const list = await listChatSessions()
      setSessions(list)
      if (list.length > 0 && !activeSession) {
        await selectSession(list[0])
      } else if (list.length === 0) {
        await handleNewSession()
      }
    } catch {
      // silently fail
    }
  }

  async function selectSession(session: ChatSession) {
    setActiveSession(session)
    setShowSessions(false)
    try {
      const msgs = await getChatMessages(session.id)
      setMessages(msgs)
    } catch {
      setMessages([])
    }
  }

  async function handleNewSession() {
    try {
      const session = await createChatSession()
      setSessions((prev) => [session, ...prev])
      setActiveSession(session)
      setMessages([])
      setShowSessions(false)
    } catch {
      // silently fail
    }
  }

  async function handleDeleteSession(session: ChatSession, e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await deleteChatSession(session.id)
      const updated = sessions.filter((s) => s.id !== session.id)
      setSessions(updated)
      if (activeSession?.id === session.id) {
        if (updated.length > 0) {
          await selectSession(updated[0])
        } else {
          await handleNewSession()
        }
      }
    } catch {
      // silently fail
    }
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || loading || !activeSession) return

    setInput("")
    setLoading(true)

    const optimistic: ChatMessage = {
      id: `optimistic-${Date.now()}`,
      session_id: activeSession.id,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimistic])

    try {
      const response = await sendChatMessage(activeSession.id, text)
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimistic.id),
        { ...optimistic, id: `user-${response.id}` },
        response,
      ])
      // update session title if it was just set
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id
            ? { ...s, title: s.title ?? text.slice(0, 60) }
            : s,
        ),
      )
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {open && (
        <div
          className="flex flex-col overflow-hidden rounded-2xl border shadow-2xl"
          style={{
            width: 380,
            height: 560,
            background: "#ffffff",
            borderColor: "#e2e8f0",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-2 px-4 py-3"
            style={{ background: "#016ac9", color: "#fff" }}
          >
            <MessageCircle className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-sm font-semibold">BOL Agent</span>

            <button
              type="button"
              onClick={handleNewSession}
              className="rounded p-1 transition-colors hover:bg-white/20"
              title="New session"
            >
              <Plus className="h-4 w-4" />
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowSessions((v) => !v)}
                className="max-w-[130px] truncate rounded px-2 py-1 text-xs transition-colors hover:bg-white/20"
                title="Switch session"
              >
                {activeSession?.title ?? "New chat"}
              </button>

              {showSessions && (
                <div
                  className="absolute right-0 top-full mt-1 w-64 overflow-hidden rounded-lg border bg-white shadow-xl"
                  style={{ borderColor: "#e2e8f0" }}
                >
                  <div className="max-h-52 overflow-y-auto">
                    {sessions.map((s) => (
                      <div
                        key={s.id}
                        className="group flex cursor-pointer items-center gap-2 px-3 py-2.5 text-[13px] transition-colors hover:bg-[#f0f4f8]"
                        style={{
                          color: s.id === activeSession?.id ? "#016ac9" : "#1e293b",
                          fontWeight: s.id === activeSession?.id ? 600 : 400,
                        }}
                        onClick={() => selectSession(s)}
                      >
                        <span className="flex-1 truncate">
                          {s.title ?? "New chat"}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteSession(s, e)}
                          className="hidden rounded p-0.5 text-red-400 hover:text-red-600 group-hover:flex"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-1 transition-colors hover:bg-white/20"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3" style={{ background: "#f8fafc" }}>
            {messages.length === 0 && !loading && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <MessageCircle className="h-8 w-8" style={{ color: "#cbd5e1" }} />
                <p className="text-sm font-medium" style={{ color: "#64748b" }}>
                  Ask about your BOL documents
                </p>
                <p className="text-xs" style={{ color: "#94a3b8" }}>
                  e.g. "Show fields from document X" or "How many are approved?"
                </p>
              </div>
            )}

            <div className="flex flex-col gap-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {msg.role === "user" ? (
                    <div
                      className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed"
                      style={{ background: "#016ac9", color: "#fff", borderBottomRightRadius: 4 }}
                    >
                      {msg.content}
                    </div>
                  ) : (
                    <div
                      className="max-w-[92%] rounded-2xl px-4 py-3"
                      style={{
                        background: "#ffffff",
                        border: "1px solid #e2e8f0",
                        borderBottomLeftRadius: 4,
                      }}
                    >
                      <MarkdownMessage content={msg.content} />
                    </div>
                  )}
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div
                    className="flex items-center gap-1.5 rounded-2xl px-4 py-3"
                    style={{ background: "#fff", border: "1px solid #e2e8f0", borderBottomLeftRadius: 4 }}
                  >
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="h-1.5 w-1.5 rounded-full"
                        style={{
                          background: "#016ac9",
                          animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          </div>

          {/* Input */}
          <div
            className="flex items-end gap-2 border-t px-3 py-3"
            style={{ borderColor: "#e2e8f0", background: "#fff" }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your BOL documents…"
              disabled={loading}
              className="flex-1 resize-none rounded-lg border px-3 py-2 text-[13.5px] outline-none transition-colors"
              style={{
                borderColor: "#e2e8f0",
                maxHeight: 96,
                lineHeight: "1.5",
                color: "#1e293b",
              }}
              onInput={(e) => {
                const el = e.currentTarget
                el.style.height = "auto"
                el.style.height = `${Math.min(el.scrollHeight, 96)}px`
              }}
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-40"
              style={{ background: "#016ac9", color: "#fff" }}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Floating button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-13 w-13 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95"
        style={{ background: "#016ac9", color: "#fff", width: 52, height: 52 }}
        aria-label="Open BOL Agent"
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </button>

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-5px); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

export default ChatWidget
