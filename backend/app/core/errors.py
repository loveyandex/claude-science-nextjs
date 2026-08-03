"""Domain-level exceptions.

These are raised by services, which know nothing about HTTP. The API
layer is the only place that decides what status code each one becomes
(see `app.api.exception_handlers`), so a service stays reusable from a
CLI, a worker, or a test without dragging FastAPI along with it.
"""

from __future__ import annotations


class ServiceError(Exception):
    """Base class for every error this service raises deliberately."""


class ConfigurationError(ServiceError):
    """Something required wasn't configured (a missing key, URL, etc.)."""


class VectorStoreError(ServiceError):
    """Talking to Qdrant failed, or the collection isn't usable."""


class RateLimitedError(ServiceError):
    """A model provider rate-limited a given credential for this run."""


class UpstreamError(ServiceError):
    """A dependency we call out to (PDF host, Next.js, provider) failed."""
