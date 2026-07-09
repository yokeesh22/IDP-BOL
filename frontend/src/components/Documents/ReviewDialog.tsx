import { Check, Loader2, X } from "lucide-react"
import { useEffect, useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { ReviewStatus } from "@/lib/api"
import { cn } from "@/lib/utils"

interface ReviewDialogProps {
  open: boolean
  decision: ReviewStatus
  filename: string
  currentStatus: ReviewStatus | null
  currentComment: string | null
  isSaving: boolean
  onClose: () => void
  onConfirm: (comment: string | null) => void
}

export function ReviewDialog({
  open,
  decision,
  filename,
  currentStatus,
  currentComment,
  isSaving,
  onClose,
  onConfirm,
}: ReviewDialogProps) {
  const [comment, setComment] = useState("")
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (open) {
      setComment(currentComment ?? "")
      setTouched(false)
    }
  }, [open, currentComment])

  const isApprove = decision === "approved"
  const isUpdate = currentStatus !== null && currentStatus !== decision
  const isResubmit = currentStatus === decision

  const trimmed = comment.trim()
  const requiresReason = !isApprove
  const canSubmit = !requiresReason || trimmed.length > 0

  const title = isApprove
    ? isResubmit
      ? "Re-approve document"
      : isUpdate
        ? "Change to approved"
        : "Approve document"
    : isResubmit
      ? "Update rejection"
      : isUpdate
        ? "Change to rejected"
        : "Reject document"

  const description = isApprove
    ? "Confirm you've reviewed this document and accept its contents. You can change your decision later."
    : "Provide a short reason for rejecting this document. The reviewer's note will be saved alongside the decision."

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !isSaving && onClose()}>
      <DialogContent className="sm:max-w-[480px]" showCloseButton={!isSaving}>
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2.5">
            <span
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-full",
                isApprove
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-red-100 text-red-700",
              )}
            >
              {isApprove ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
            </span>
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-secondary px-3 py-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Document
          </div>
          <div className="mt-0.5 truncate text-[13px] font-medium text-foreground" title={filename}>
            {filename}
          </div>
          {currentStatus && (
            <div className="mt-2 text-[11.5px] text-muted-foreground">
              Current decision:{" "}
              <span
                className={cn(
                  "font-medium",
                  currentStatus === "approved" ? "text-emerald-700" : "text-red-700",
                )}
              >
                {currentStatus === "approved" ? "Approved" : "Rejected"}
              </span>
            </div>
          )}
        </div>

        {!isApprove && (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="review-reason"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              id="review-reason"
              autoFocus
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="Explain why this document is being rejected…"
              className={cn(
                "min-h-[100px] w-full resize-y rounded-md border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-primary",
                touched && !canSubmit && "border-red-400 focus:border-red-500",
              )}
            />
            {touched && !canSubmit && (
              <span className="text-[11.5px] text-red-600">A reason is required.</span>
            )}
          </div>
        )}

        {isApprove && (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="review-note"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Note <span className="text-muted-foreground/70 normal-case">(optional)</span>
            </label>
            <textarea
              id="review-note"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add an optional note for your records…"
              className="min-h-[72px] w-full resize-y rounded-md border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
            />
          </div>
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-md border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSaving || !canSubmit}
            onClick={() => {
              setTouched(true)
              if (!canSubmit) return
              onConfirm(trimmed || null)
            }}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white transition-all disabled:opacity-60",
              isApprove
                ? "bg-emerald-600 hover:bg-emerald-700"
                : "bg-red-600 hover:bg-red-700",
            )}
          >
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isApprove ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
            {isApprove ? "Approve" : "Reject"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
