"""Internal API key verification.

This service is reachable only by the Node backend, server-to-server — never by
a browser. A single shared secret in a header is the right weight of mechanism
for that; there are no user identities here to model.
"""

from __future__ import annotations

import secrets

from fastapi import Header, HTTPException, status

from app.core.config import API_KEY_HEADER, settings


async def require_api_key(
    x_internal_api_key: str | None = Header(default=None, alias=API_KEY_HEADER),
) -> None:
    """FastAPI dependency enforcing the shared secret.

    Compared with compare_digest rather than ==, so the check takes the same
    time regardless of how many leading characters a guess got right. Missing
    and wrong keys both return 401 with the same message — telling a caller
    which one it was gives away whether they found a real header name.
    """
    if x_internal_api_key is None or not secrets.compare_digest(
        x_internal_api_key, settings.INTERNAL_API_KEY
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing internal API key",
        )
