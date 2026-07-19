import uuid

from fastapi import APIRouter, HTTPException
from langchain_core.messages import AIMessage, HumanMessage
from pydantic import BaseModel
from sqlmodel import select

from app.api.deps import CurrentUser, SessionDep
from app.models import ChatMessage, ChatMessagePublic, ChatSession, ChatSessionPublic
from app.services.db_chat import invoke_chat, invoke_document_chat
from app.services.usage import record_chat_usage

router = APIRouter(prefix="/chat", tags=["chat"])


class CreateSessionRequest(BaseModel):
    document_id: uuid.UUID | None = None


class SendMessageRequest(BaseModel):
    message: str


# ── Sessions ──────────────────────────────────────────────────────────────────

@router.post("/sessions", response_model=ChatSessionPublic)
async def create_session(
    request: CreateSessionRequest,
    db: SessionDep,
    current_user: CurrentUser,
) -> ChatSessionPublic:
    session = ChatSession(user_id=current_user.id, document_id=request.document_id)
    db.add(session)
    db.commit()
    db.refresh(session)
    return ChatSessionPublic.model_validate(session)


@router.get("/sessions", response_model=list[ChatSessionPublic])
async def list_sessions(db: SessionDep, current_user: CurrentUser) -> list[ChatSessionPublic]:
    sessions = db.exec(
        select(ChatSession)
        .where(ChatSession.user_id == current_user.id)
        .where(ChatSession.document_id.is_(None))  # type: ignore[union-attr]
        .order_by(ChatSession.created_at.desc())  # type: ignore[arg-type]
    ).all()
    return [ChatSessionPublic.model_validate(s) for s in sessions]


@router.get("/sessions/document/{document_id}", response_model=list[ChatSessionPublic])
async def list_document_sessions(
    document_id: uuid.UUID, db: SessionDep, current_user: CurrentUser
) -> list[ChatSessionPublic]:
    sessions = db.exec(
        select(ChatSession)
        .where(ChatSession.user_id == current_user.id)
        .where(ChatSession.document_id == document_id)
        .order_by(ChatSession.created_at.desc())  # type: ignore[arg-type]
    ).all()
    return [ChatSessionPublic.model_validate(s) for s in sessions]


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: uuid.UUID, db: SessionDep, current_user: CurrentUser
) -> dict[str, str]:
    session = db.get(ChatSession, session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")
    db.delete(session)
    db.commit()
    return {"message": "Session deleted"}


# ── Messages ──────────────────────────────────────────────────────────────────

@router.get("/sessions/{session_id}/messages", response_model=list[ChatMessagePublic])
async def get_messages(
    session_id: uuid.UUID, db: SessionDep, current_user: CurrentUser
) -> list[ChatMessagePublic]:
    session = db.get(ChatSession, session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")

    msgs = db.exec(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at)  # type: ignore[arg-type]
    ).all()
    return [ChatMessagePublic.model_validate(m) for m in msgs]


@router.post("/sessions/{session_id}/messages", response_model=ChatMessagePublic)
async def send_message(
    session_id: uuid.UUID,
    request: SendMessageRequest,
    db: SessionDep,
    current_user: CurrentUser,
) -> ChatMessagePublic:
    chat_session = db.get(ChatSession, session_id)
    if not chat_session or chat_session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")

    history = db.exec(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at)  # type: ignore[arg-type]
    ).all()

    user_msg = ChatMessage(session_id=session_id, role="user", content=request.message)
    db.add(user_msg)
    db.commit()

    lc_messages = []
    for msg in history:
        if msg.role == "user":
            lc_messages.append(HumanMessage(content=msg.content))
        else:
            lc_messages.append(AIMessage(content=msg.content))
    lc_messages.append(HumanMessage(content=request.message))

    try:
        if chat_session.document_id:
            response_text, usage = await invoke_document_chat(
                str(chat_session.document_id), lc_messages
            )
        else:
            response_text, usage = await invoke_chat(lc_messages)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    assistant_msg = ChatMessage(
        session_id=session_id,
        role="assistant",
        content=response_text,
        ai_input_tokens=usage[0],
        ai_output_tokens=usage[1],
    )
    db.add(assistant_msg)

    if not chat_session.title:
        chat_session.title = request.message[:100]
        db.add(chat_session)

    # Persist billable AI usage in the ledger so cost survives chat/document
    # deletion. Use the (possibly just-set) title as the denormalized label.
    record_chat_usage(
        db,
        label=chat_session.title,
        document_id=chat_session.document_id,
        user_id=current_user.id,
        input_tokens=usage[0],
        output_tokens=usage[1],
    )

    db.commit()
    db.refresh(assistant_msg)
    return ChatMessagePublic.model_validate(assistant_msg)
