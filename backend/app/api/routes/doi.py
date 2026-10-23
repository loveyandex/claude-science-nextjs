"""DOI pipeline endpoints, called by Next.js's /api/doi-articles/transcribe.

Transcribing a whole PDF takes far longer than an HTTP client will wait
for response headers (Node's fetch gives up after 300s), so the work runs
as a background job: POST starts it and returns a job id immediately, and
the caller polls GET /doi/jobs/{id} for the outcome. Pages still reach
Next.js one by one through /api/doi-articles/ingest-page as they finish.
Jobs live in this process's memory only — a restart forgets them, which
the caller sees as a 404 and reports as a failed run (pages already
pushed are kept, so a re-run resumes).
"""

from __future__ import annotations

import threading
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.api.schemas import TranscribeDoiPdfRequest
from app.core.security import require_internal_secret
from app.dependencies import get_doi_transcription_service
from app.services.doi_transcriber import DoiPdfTranscriptionService
from app.services.transcription import OpenAICompatibleTranscriber

router = APIRouter(prefix="/doi", tags=["doi"], dependencies=[Depends(require_internal_secret)])

_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()
# Finished jobs kept around for polling; oldest dropped past this.
MAX_FINISHED_JOBS = 50


def _set_job(job_id: str, value: dict) -> None:
    with _jobs_lock:
        _jobs[job_id] = value
        finished = [k for k, v in _jobs.items() if v["status"] == "done"]
        for k in finished[: max(0, len(finished) - MAX_FINISHED_JOBS)]:
            del _jobs[k]


@router.post("/transcribe-pdf")
def transcribe_pdf(
    body: TranscribeDoiPdfRequest,
    service: DoiPdfTranscriptionService = Depends(get_doi_transcription_service),
) -> dict:
    transcriber = OpenAICompatibleTranscriber(
        base_url=body.provider.baseUrl,
        api_key=body.provider.apiKey,
        model=body.provider.model,
    )
    job_id = uuid.uuid4().hex
    _set_job(job_id, {"status": "running", "doi": body.doi})

    def run() -> None:
        outcome = service.transcribe_pdf(
            doi=body.doi,
            skip_pages=body.skipPages,
            transcriber=transcriber,
            concurrency=body.concurrency,
            dpi=body.dpi,
        )
        _set_job(job_id, {"status": "done", "doi": body.doi, "result": outcome.to_response()})

    threading.Thread(target=run, name=f"doi-{job_id[:8]}", daemon=True).start()
    return {"ok": True, "jobId": job_id}


@router.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    with _jobs_lock:
        job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown job — the backend may have restarted.")
    return job
