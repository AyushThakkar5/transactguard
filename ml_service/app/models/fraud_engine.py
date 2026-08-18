"""Rule-based fraud scoring engine.

A deterministic stand-in for the XGBoost model arriving in Step 8. The point is
to get the full prediction path working end to end with something explainable:
same request shape, same response shape, same explanation structure, so swapping
in a real model later touches only this file.

Five weighted factors each produce a magnitude in [0, 1]. The final score is the
weighted sum scaled to 0-100:

    score = 100 * Σ (weight_i × magnitude_i)

Because the weights sum to exactly 1.0, a transaction that maxes out every
factor scores 100 and one that fires nothing scores 0 — no clamping needed for
the arithmetic to stay in range, though it is applied anyway as a guard.

Everything here is pure computation with no I/O, so a single call runs in
microseconds.
"""

from __future__ import annotations

import time
from typing import Callable, Dict, List, NamedTuple, Optional

MODEL_VERSION = "rule-based-v1"

# Weights sum to 1.0. Sourced from the blueprint's risk-scoring table.
FACTOR_WEIGHTS: Dict[str, float] = {
    "amount_anomaly": 0.35,
    "balance_drain": 0.25,
    "destination_anomaly": 0.20,
    "txn_type_risk": 0.10,
    "round_amount_bias": 0.10,
}

# Fixed reference point for "large". This is the crudest part of the engine and
# the first thing the real model replaces: once there is enough history, this
# becomes amount vs. the sender's own rolling average and standard deviation,
# so a $50k transfer is unremarkable for a corporate account and alarming for
# one that has never moved more than $500.
HIGH_AMOUNT_THRESHOLD = 200_000.0

# Relative risk per transaction type. TRANSFER and CASH_OUT dominate the fraud
# literature (and PaySim's own labels — every fraudulent row in the dataset is
# one of those two), because they are how value actually leaves an account.
TXN_TYPE_RISK: Dict[str, float] = {
    "TRANSFER": 1.00,
    "CASH_OUT": 0.90,
    "DEBIT": 0.30,
    "PAYMENT": 0.20,
    "CASH_IN": 0.10,
}
UNKNOWN_TYPE_RISK = 0.50

# Types where the originating balance is expected to fall. CASH_IN is the one
# that moves the other way, and scoring it with the wrong sign would make every
# legitimate deposit look like a balance mismatch.
OUTFLOW_TYPES = frozenset({"TRANSFER", "CASH_OUT", "PAYMENT", "DEBIT"})

# Floating point balances rarely reconcile to the cent; anything under a dollar
# of discrepancy is rounding, not evidence.
BALANCE_TOLERANCE = 1.0

# Factors weaker than this are noise and are left out of the explanation, so a
# CLEAR transaction does not arrive with five paragraphs of reassurance.
MIN_REPORTED_MAGNITUDE = 0.05

RISK_LEVEL_THRESHOLDS = (
    (40, "CLEAR"),        # 0-40
    (75, "SUSPICIOUS"),   # 41-75
    (100, "CRITICAL"),    # 76-100
)


class FactorResult(NamedTuple):
    """One factor's verdict.

    `description` stands alone in the contributions array; `clause` is a
    lowercase fragment stitched into the summary sentence.
    """

    magnitude: float
    description: str
    clause: str


def _to_cents(amount: float) -> int:
    """Money as integer cents, so modulo tests are exact rather than floaty."""
    return int(round(amount * 100))


def _money(amount: float) -> str:
    return f"${amount:,.2f}"


# --------------------------------------------------------------------------
# Factor 1 — amount anomaly (35%)
# --------------------------------------------------------------------------
def _score_amount_anomaly(txn) -> FactorResult:
    magnitude = min(txn.amount / HIGH_AMOUNT_THRESHOLD, 1.0)

    if magnitude >= 1.0:
        description = (
            f"Amount of {_money(txn.amount)} meets or exceeds the "
            f"{_money(HIGH_AMOUNT_THRESHOLD)} high-value threshold"
        )
        clause = f"the amount of {_money(txn.amount)} is unusually high"
    else:
        pct = magnitude * 100
        description = (
            f"Amount of {_money(txn.amount)} is {pct:.0f}% of the "
            f"{_money(HIGH_AMOUNT_THRESHOLD)} high-value threshold"
        )
        clause = f"the amount of {_money(txn.amount)} is moderately large"

    return FactorResult(magnitude, description, clause)


# --------------------------------------------------------------------------
# Factor 2 — balance drain (25%)
# --------------------------------------------------------------------------
def _score_balance_drain(txn) -> FactorResult:
    """Two related signals: the account was emptied, or the books do not balance."""
    txn_type = txn.txn_type.value if hasattr(txn.txn_type, "value") else str(txn.txn_type)

    if txn_type in OUTFLOW_TYPES:
        expected_after = txn.orig_balance_before - txn.amount
    else:  # CASH_IN moves value the other way
        expected_after = txn.orig_balance_before + txn.amount

    discrepancy = abs(expected_after - txn.orig_balance_after)
    mismatch_magnitude = (
        0.0
        if discrepancy <= BALANCE_TOLERANCE
        else min(discrepancy / max(txn.amount, 1.0), 1.0)
    )

    # A balance taken to exactly zero is the classic account-drain pattern: the
    # fraudster moves the whole balance, not a round number they picked.
    fully_drained = txn.orig_balance_before > 0 and txn.orig_balance_after == 0

    if fully_drained:
        magnitude = 1.0
        description = (
            f"Sender balance was fully drained from {_money(txn.orig_balance_before)} "
            f"to zero"
        )
        clause = (
            f"the sending account was drained from {_money(txn.orig_balance_before)} to zero"
        )
    elif mismatch_magnitude > 0:
        magnitude = mismatch_magnitude
        description = (
            f"Sender balance is inconsistent: expected {_money(expected_after)} "
            f"after the transaction, recorded {_money(txn.orig_balance_after)}"
        )
        clause = (
            f"the sending account's balance does not reconcile "
            f"(off by {_money(discrepancy)})"
        )
    else:
        magnitude = 0.0
        description = "Sender balance reconciles with the transaction amount"
        clause = ""

    return FactorResult(magnitude, description, clause)


# --------------------------------------------------------------------------
# Factor 3 — destination anomaly (20%)
# --------------------------------------------------------------------------
def _score_destination_anomaly(txn) -> FactorResult:
    """An empty receiving account is a mule-account signature, more so for large sums."""
    if txn.dest_balance_before > 0:
        return FactorResult(
            0.0, "Receiving account had an established balance", ""
        )

    # Money arrived at an account that held nothing and still holds nothing —
    # it was swept onward immediately.
    if txn.amount > 0 and txn.dest_balance_after == 0:
        return FactorResult(
            1.0,
            (
                "Receiving account was empty before the transaction and remains empty "
                "after it — funds were moved straight through"
            ),
            "the receiving account was empty before and after, indicating funds passed straight through",
        )

    # Empty-before alone is a moderate signal; a large amount landing in one
    # sharpens it.
    magnitude = 0.6 + 0.4 * min(txn.amount / HIGH_AMOUNT_THRESHOLD, 1.0)
    return FactorResult(
        magnitude,
        "Receiving account had a zero balance before this transaction",
        "the receiving account had a zero balance before this transaction",
    )


# --------------------------------------------------------------------------
# Factor 4 — transaction type risk (10%)
# --------------------------------------------------------------------------
def _score_txn_type_risk(txn) -> FactorResult:
    txn_type = txn.txn_type.value if hasattr(txn.txn_type, "value") else str(txn.txn_type)
    magnitude = TXN_TYPE_RISK.get(txn_type, UNKNOWN_TYPE_RISK)

    # Every type carries some weight, but only the genuinely risky ones earn a
    # mention in the summary. Without this floor a small PAYMENT would be
    # explained as "the transaction type PAYMENT is inherently higher-risk",
    # which is both alarming and the opposite of what its 0.20 weight means.
    clause = (
        f"the transaction type {txn_type} is inherently higher-risk"
        if magnitude >= 0.5
        else ""
    )

    return FactorResult(
        magnitude,
        f"Transaction type {txn_type} carries a relative fraud risk of {magnitude:.2f}",
        clause,
    )


# --------------------------------------------------------------------------
# Factor 5 — round-number bias (10%)
# --------------------------------------------------------------------------
def _score_round_amount_bias(txn) -> FactorResult:
    """Humans pick round numbers; organic transaction amounts rarely are."""
    if txn.amount <= 0:
        return FactorResult(0.0, "No amount to evaluate for round-number bias", "")

    cents = _to_cents(txn.amount)

    for unit, magnitude in ((10_000, 1.0), (5_000, 0.8), (1_000, 0.6), (100, 0.3)):
        if cents % (unit * 100) == 0:
            return FactorResult(
                magnitude,
                f"Amount is an exact multiple of {_money(unit)}",
                f"the amount is a suspiciously round {_money(txn.amount)}",
            )

    return FactorResult(0.0, "Amount is not a round number", "")


FACTOR_SCORERS: Dict[str, Callable[[object], FactorResult]] = {
    "amount_anomaly": _score_amount_anomaly,
    "balance_drain": _score_balance_drain,
    "destination_anomaly": _score_destination_anomaly,
    "txn_type_risk": _score_txn_type_risk,
    "round_amount_bias": _score_round_amount_bias,
}


def _risk_level(score: int) -> str:
    for upper_bound, level in RISK_LEVEL_THRESHOLDS:
        if score <= upper_bound:
            return level
    return "CRITICAL"


def _build_summary(contributions: List[dict], clauses: Dict[str, str], score: int) -> str:
    """One or two plain-English sentences from the top factors."""
    if not contributions:
        return (
            "No risk factors of note — this transaction is consistent with "
            "normal account activity."
        )

    top = [c for c in contributions[:3] if clauses.get(c["factor"])]
    if not top:
        return (
            "No risk factors of note — this transaction is consistent with "
            "normal account activity."
        )

    parts = [clauses[c["factor"]] for c in top]
    sentence = "; ".join(parts)
    sentence = sentence[0].upper() + sentence[1:] + "."

    level = _risk_level(score)
    if level == "CLEAR":
        return f"{sentence} Overall risk remains low."
    if level == "SUSPICIOUS":
        return f"{sentence} This warrants analyst review."
    return f"{sentence} This transaction should be treated as high risk."


def score_transaction(txn) -> dict:
    """Score one transaction.

    :param txn: anything exposing the TransactionInput attributes
    :returns: dict matching PredictionResponse, including its own latency_ms
    """
    started = time.perf_counter()

    contributions: List[dict] = []
    clauses: Dict[str, str] = {}
    total = 0.0

    for factor, scorer in FACTOR_SCORERS.items():
        weight = FACTOR_WEIGHTS[factor]
        result = scorer(txn)

        magnitude = max(0.0, min(result.magnitude, 1.0))
        contribution = weight * magnitude
        total += contribution

        clauses[factor] = result.clause

        if magnitude >= MIN_REPORTED_MAGNITUDE:
            contributions.append(
                {
                    "factor": factor,
                    "description": result.description,
                    "magnitude": round(magnitude, 4),
                    "weight": weight,
                    "contribution": round(contribution * 100, 2),
                }
            )

    # Sorted by points contributed, not raw magnitude, so the first entry is the
    # factor that actually moved the score most.
    contributions.sort(key=lambda c: c["contribution"], reverse=True)

    risk_score = max(0, min(100, round(total * 100)))
    latency_ms = round((time.perf_counter() - started) * 1000)

    return {
        "txn_id": txn.txn_id,
        "risk_score": risk_score,
        "risk_level": _risk_level(risk_score),
        "explanation_summary": _build_summary(contributions, clauses, risk_score),
        "feature_contributions": contributions,
        "model_version": MODEL_VERSION,
        "latency_ms": latency_ms,
    }


def score_batch(transactions) -> List[dict]:
    """Score many transactions. Each result carries its own latency_ms."""
    return [score_transaction(txn) for txn in transactions]
