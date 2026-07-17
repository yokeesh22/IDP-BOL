import base64
import binascii
import json
from datetime import timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.security import OAuth2PasswordRequestForm

from app import crud
from app.api.deps import CurrentUser, SessionDep, get_current_active_superuser
from app.core import security
from app.core.config import settings
from app.models import Message, NewPassword, Token, UserPublic, UserUpdate
from app.utils import (
    generate_password_reset_token,
    generate_reset_password_email,
    send_email,
    verify_password_reset_token,
)

router = APIRouter(tags=["login"])


@router.post("/login/access-token")
def login_access_token(
    session: SessionDep, form_data: Annotated[OAuth2PasswordRequestForm, Depends()]
) -> Token:
    """
    OAuth2 compatible token login, get an access token for future requests
    """
    user = crud.authenticate(
        session=session, email=form_data.username, password=form_data.password
    )
    if not user:
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    elif not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return Token(
        access_token=security.create_access_token(
            user.id, expires_delta=access_token_expires
        )
    )


def _sso_email_from_headers(request: Request) -> str | None:
    """Extract the signed-in user's email from Azure Easy Auth headers.

    Azure Container Apps' built-in authentication injects the identity of the
    signed-in user into request headers on every request that reaches the
    container. External clients cannot set these headers (the platform strips
    them at the ingress), so they are safe to trust here. The backend is not
    publicly reachable either — nginx is the only public container and proxies
    to it over localhost — so these headers always originate from the platform.

    We prefer the simple ``X-MS-CLIENT-PRINCIPAL-NAME`` header (the UPN/email),
    and fall back to decoding the base64 JSON ``X-MS-CLIENT-PRINCIPAL`` header
    and searching its claims.
    """
    name = request.headers.get("X-MS-CLIENT-PRINCIPAL-NAME")
    if name and name.strip():
        return name.strip().lower()

    encoded = request.headers.get("X-MS-CLIENT-PRINCIPAL")
    if not encoded:
        return None
    try:
        decoded = base64.b64decode(encoded).decode("utf-8")
        principal = json.loads(decoded)
    except (binascii.Error, ValueError, UnicodeDecodeError):
        return None

    claims = principal.get("claims") if isinstance(principal, dict) else None
    if not isinstance(claims, list):
        return None
    by_type: dict[str, str] = {}
    for claim in claims:
        if isinstance(claim, dict) and claim.get("typ") and claim.get("val"):
            by_type.setdefault(str(claim["typ"]), str(claim["val"]))

    for key in (
        "preferred_username",
        "email",
        "emails",
        "upn",
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
    ):
        val = by_type.get(key)
        if val and val.strip():
            return val.strip().lower()
    return None


@router.post("/login/sso")
def login_sso(request: Request, session: SessionDep) -> Token:
    """Exchange an Azure SSO (Easy Auth) session for an app access token.

    The user has already been authenticated by the Container Apps auth layer;
    we read their email from the injected headers and issue our own JWT so the
    rest of the app (which is JWT-based) works unchanged.

    Distinct status codes let the frontend react correctly:
      * 401 — no SSO identity present (user isn't signed in with Microsoft yet).
      * 403 — signed in with Microsoft, but no matching/active app account
              (accounts must be created by an admin first — no auto-provision).
    """
    email = _sso_email_from_headers(request)
    if not email:
        raise HTTPException(status_code=401, detail="No SSO identity present")

    user = crud.get_user_by_email(session=session, email=email)
    if not user or not user.is_active:
        raise HTTPException(
            status_code=403,
            detail="This account is not authorized for this application. "
            "Please contact an administrator.",
        )

    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return Token(
        access_token=security.create_access_token(
            user.id, expires_delta=access_token_expires
        )
    )


@router.post("/login/test-token", response_model=UserPublic)
def test_token(current_user: CurrentUser) -> Any:
    """
    Test access token
    """
    return current_user


@router.post("/password-recovery/{email}")
def recover_password(email: str, session: SessionDep) -> Message:
    """
    Password Recovery
    """
    user = crud.get_user_by_email(session=session, email=email)

    # Always return the same response to prevent email enumeration attacks
    # Only send email if user actually exists
    if user:
        password_reset_token = generate_password_reset_token(email=email)
        email_data = generate_reset_password_email(
            email_to=user.email, email=email, token=password_reset_token
        )
        send_email(
            email_to=user.email,
            subject=email_data.subject,
            html_content=email_data.html_content,
        )
    return Message(
        message="If that email is registered, we sent a password recovery link"
    )


@router.post("/reset-password/")
def reset_password(session: SessionDep, body: NewPassword) -> Message:
    """
    Reset password
    """
    email = verify_password_reset_token(token=body.token)
    if not email:
        raise HTTPException(status_code=400, detail="Invalid token")
    user = crud.get_user_by_email(session=session, email=email)
    if not user:
        # Don't reveal that the user doesn't exist - use same error as invalid token
        raise HTTPException(status_code=400, detail="Invalid token")
    elif not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    user_in_update = UserUpdate(password=body.new_password)
    crud.update_user(
        session=session,
        db_user=user,
        user_in=user_in_update,
    )
    return Message(message="Password updated successfully")


@router.post(
    "/password-recovery-html-content/{email}",
    dependencies=[Depends(get_current_active_superuser)],
    response_class=HTMLResponse,
)
def recover_password_html_content(email: str, session: SessionDep) -> Any:
    """
    HTML Content for Password Recovery
    """
    user = crud.get_user_by_email(session=session, email=email)

    if not user:
        raise HTTPException(
            status_code=404,
            detail="The user with this username does not exist in the system.",
        )
    password_reset_token = generate_password_reset_token(email=email)
    email_data = generate_reset_password_email(
        email_to=user.email, email=email, token=password_reset_token
    )

    return HTMLResponse(
        content=email_data.html_content, headers={"subject:": email_data.subject}
    )
