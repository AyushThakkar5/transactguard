"""Pydantic request/response models for the prediction API.

The response shape here is the contract with the Node backend: Step 5 will
persist `feature_contributions` and `explanation_summary` straight into the
Prisma `Prediction` model without reshaping them, so these field names are
deliberately aligned with that schema.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import List

from pydantic import BaseModel, ConfigDict, Field

# Kept in sync with the Prisma schema's transaction types (Step 2).
TXN_TYPES = ("TRANSFER", "CASH_OUT", "PAYMENT", "CASH_IN", "DEBIT")

MAX_BATCH_SIZE = 100


class TxnType(str, Enum):
    TRANSFER = "TRANSFER"
    CASH_OUT = "CASH_OUT"
    PAYMENT = "PAYMENT"
    CASH_IN = "CASH_IN"
    DEBIT = "DEBIT"


class RiskLevel(str, Enum):
    CLEAR = "CLEAR"
    SUSPICIOUS = "SUSPICIOUS"
    CRITICAL = "CRITICAL"


class TransactionInput(BaseModel):
    """A subset of the Transaction record — only the fields the scorer reads."""

    model_config = ConfigDict(extra="forbid")

    txn_id: str = Field(min_length=1, max_length=120)
    txn_type: TxnType
    amount: float = Field(ge=0, le=1e15)
    sender_id: str = Field(min_length=1, max_length=120)
    receiver_id: str = Field(min_length=1, max_length=120)

    # Balances are non-negative in PaySim. They stay required rather than
    # optional because every balance-based rule silently loses its signal when
    # one is missing, and a quietly degraded score is worse than a 422.
    orig_balance_before: float = Field(ge=0, le=1e15)
    orig_balance_after: float = Field(ge=0, le=1e15)
    dest_balance_before: float = Field(ge=0, le=1e15)
    dest_balance_after: float = Field(ge=0, le=1e15)

    txn_timestamp: datetime


class BatchPredictionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    transactions: List[TransactionInput] = Field(min_length=1, max_length=MAX_BATCH_SIZE)


class FeatureContribution(BaseModel):
    """One scoring factor that fired, in the order it mattered.

    `magnitude` is how strongly the factor itself fired (0-1), independent of
    how much the model cares about it. `weight` is that importance, and
    `contribution` is the resulting points out of 100 — which is what the array
    is sorted by, so the first entry is genuinely the biggest driver of the
    score rather than merely the most saturated rule.
    """

    factor: str
    description: str
    magnitude: float = Field(ge=0, le=1)
    weight: float = Field(ge=0, le=1)
    contribution: float = Field(ge=0, le=100)


class PredictionResponse(BaseModel):
    txn_id: str
    risk_score: int = Field(ge=0, le=100)
    risk_level: RiskLevel
    explanation_summary: str
    feature_contributions: List[FeatureContribution]
    model_version: str
    latency_ms: int


class BatchPredictionResponse(BaseModel):
    results: List[PredictionResponse]


class HealthResponse(BaseModel):
    status: str
    model_version: str
