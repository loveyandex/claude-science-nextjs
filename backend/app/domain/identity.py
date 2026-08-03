"""Stable identity for a chunk in the vector store.

Lives in the domain rather than the Qdrant adapter because *what a chunk
is called* is a rule of this system, not a detail of the database that
happens to store it: the id is what makes re-embedding a page an
idempotent overwrite instead of a pile of duplicates, and it has to stay
identical across runs, processes, and (if it ever came to it) vector
database vendors.

Qdrant only accepts UUIDs or unsigned integers as point ids, while our
natural key is "<cuid page id>:<chunk index>". uuid5 over a fixed
namespace maps that key deterministically into the allowed space.
"""

from __future__ import annotations

import uuid

_POINT_NAMESPACE = uuid.NAMESPACE_DNS


def build_point_id(page_id: str, chunk_index: int) -> str:
    return str(uuid.uuid5(_POINT_NAMESPACE, f"{page_id}:{chunk_index}"))
