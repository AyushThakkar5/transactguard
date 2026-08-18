"""TransactGuard ML service — FastAPI entrypoint.

Runs independently of the Node backend:

    uvicorn app.main:app --reload --port 8000

Only the Node backend calls this service, authenticated with a shared secret in
the X-Internal-Api-Key header. Nothing here is exposed to a browser.
"""

from __future__ import annotations

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1.predict import router as predict_router
from app.core.config import MODEL_VERSION, settings
from app.core.security import require_api_key
from app.schemas.prediction import HealthResponse

app = FastAPI(
    title="TransactGuard ML Service",
    description=(
        "Rule-based fraud scoring. A deterministic, explainable stand-in for the "
        "XGBoost model arriving in Step 8 — same request and response contract, "
        "so swapping the model out touches only fraud_engine.py."
    ),
    version="0.1.0",
)


# --------------------------------------------------------------------------
# Error envelope
#
# One consistent shape for every failure, so the Node backend has a single thing
# to parse rather than FastAPI's default `detail` for some errors and a
# validation array for others.
# --------------------------------------------------------------------------
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(_request: Request, exc: StarletteHTTPException):
    codes = {400: "BAD_REQUEST", 401: "UNAUTHORIZED", 404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": codes.get(exc.status_code, "HTTP_ERROR"),
                "message": exc.detail,
            }
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Request body failed validation",
                "details": [
                    {
                        # Drop the leading "body" segment so paths read
                        # "amount" rather than "body.amount".
                        "field": ".".join(str(p) for p in err["loc"][1:]) or "body",
                        "message": err["msg"],
                        "type": err["type"],
                    }
                    for err in exc.errors()
                ],
            }
        },
    )


@app.get(
    "/health",
    response_model=HealthResponse,
    dependencies=[Depends(require_api_key)],
)
async def health() -> HealthResponse:
    """Liveness check.

    Protected, because the spec for this service is that every endpoint requires
    the internal key. That means a container healthcheck has to send the header
    too — see the README. Drop the `dependencies` argument above to make this
    endpoint public if you would rather it were.
    """
    return HealthResponse(status="ok", model_version=MODEL_VERSION)


app.include_router(predict_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=settings.PORT, reload=True)
