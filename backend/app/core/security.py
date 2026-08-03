"""Shared-secret auth for the Next.js -> Python direction.

There is no user session here: every caller is the Next.js app itself,
proving it with the `X-Internal-Secret` header both sides read from
`INTERNAL_API_SECRET`. Exposed as a FastAPI dependency so a route opts in
by declaring it, rather than each handler remembering to call a checker
(and one day forgetting).
"""

from __future__ import annotations

import hmac

from fastapi import Header, HTTPException, status

from app.config import get_settings


def require_internal_secret(x_internal_secret: str | None = Header(default=None)) -> None:
    expected = get_settings().internal_api_secret
    if not expected or not x_internal_secret or not hmac.compare_digest(x_internal_secret, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-Internal-Secret header.",
        )


def mask_secret(value: str) -> str:
    """Never log a raw key — first 6 + last 4 characters only."""
    if len(value) <= 10:
        return "••••••••"
    return f"{value[:6]}…{value[-4:]}"
