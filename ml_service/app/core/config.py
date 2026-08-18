"""Environment loading and validation.

Mirrors the fail-fast approach of the Node service's config/env.js: settings are
validated at import time, so a missing or too-short INTERNAL_API_KEY stops the
process at startup rather than failing the first request that needs it.
"""

from __future__ import annotations

import sys

from pydantic import Field, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    # Shared secret for server-to-server calls from the Node backend. The length
    # floor exists so a placeholder like "changeme" cannot reach a running
    # service unnoticed.
    INTERNAL_API_KEY: str = Field(min_length=16)

    PORT: int = Field(default=8000, ge=1, le=65535)

    ENV: str = Field(default="development")


def _load() -> Settings:
    try:
        return Settings()
    except ValidationError as exc:
        print("\n  Invalid ml_service environment configuration:\n", file=sys.stderr)
        for err in exc.errors():
            field = ".".join(str(p) for p in err["loc"])
            print(f"   • {field}: {err['msg']}", file=sys.stderr)
        print(
            "\n  Copy ml_service/.env.example to ml_service/.env and fill in the blanks.\n",
            file=sys.stderr,
        )
        raise SystemExit(1)


settings = _load()

MODEL_VERSION = "rule-based-v1"
API_KEY_HEADER = "X-Internal-Api-Key"
