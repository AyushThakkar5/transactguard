"""Prediction routes.

Thin by design, mirroring the Node backend's controller layer: parse, delegate
to the engine, return. All scoring logic lives in app/models/fraud_engine.py.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.security import require_api_key
from app.models.fraud_engine import score_batch, score_transaction
from app.schemas.prediction import (
    BatchPredictionRequest,
    BatchPredictionResponse,
    PredictionResponse,
    TransactionInput,
)

router = APIRouter(
    prefix="/predict",
    tags=["predict"],
    dependencies=[Depends(require_api_key)],
)


@router.post("/single", response_model=PredictionResponse)
async def predict_single(transaction: TransactionInput) -> PredictionResponse:
    """Score one transaction."""
    return PredictionResponse(**score_transaction(transaction))


@router.post("/batch", response_model=BatchPredictionResponse)
async def predict_batch(request: BatchPredictionRequest) -> BatchPredictionResponse:
    """Score up to 100 transactions in one call.

    Kept synchronous and in-process: scoring is pure computation measured in
    microseconds, so a queue or thread pool would cost more than it saves. That
    calculus changes in Step 8 when a real model is doing the work.
    """
    results = score_batch(request.transactions)
    return BatchPredictionResponse(results=[PredictionResponse(**r) for r in results])
