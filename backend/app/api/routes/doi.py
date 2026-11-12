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
from app.services.doi_transcriber import DoiPdfTranscriptionService, TranscriptionProgress
from app.services.transcription import build_vision_transcriber

router = APIRouter(prefix="/doi", tags=["doi"], dependencies=[Depends(require_internal_secret)])

_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()
# Cancel flags for running jobs, kept apart from `_jobs` since those dicts
# are returned to the caller as JSON.
_cancel_flags: dict[str, threading.Event] = {}
# Live progress per job (kept after it finishes, pruned with the job).
_progress: dict[str, TranscriptionProgress] = {}
# Finished jobs kept around for polling; oldest dropped past this.
MAX_FINISHED_JOBS = 50


def _set_job(job_id: str, value: dict) -> None:
    with _jobs_lock:
        _jobs[job_id] = value
        finished = [k for k, v in _jobs.items() if v["status"] == "done"]
        for k in finished[: max(0, len(finished) - MAX_FINISHED_JOBS)]:
            del _jobs[k]
            _progress.pop(k, None)


@router.post("/transcribe-pdf")
def transcribe_pdf(
    body: TranscribeDoiPdfRequest,
    service: DoiPdfTranscriptionService = Depends(get_doi_transcription_service),
) -> dict:
    try:
        transcriber = build_vision_transcriber(
            provider_type=body.provider.type,
            base_url=body.provider.baseUrl,
            api_key=body.provider.apiKey,
            model=body.provider.model,
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    job_id = uuid.uuid4().hex
    cancel = threading.Event()
    progress = TranscriptionProgress()
    with _jobs_lock:
        _cancel_flags[job_id] = cancel
        _progress[job_id] = progress
    _set_job(job_id, {"status": "running", "doi": body.doi})

    def run() -> None:
        try:
            outcome = service.transcribe_pdf(
                doi=body.doi,
                skip_pages=body.skipPages,
                transcriber=transcriber,
                concurrency=body.concurrency,
                dpi=body.dpi,
                cancel=cancel,
                progress=progress,
            )
            result = outcome.to_response()
        except Exception as err:  # noqa: BLE001 — never leave a job "running" forever
            result = {"ok": False, "error": f"Backend crashed during the run: {err}"}
        try:
            _set_job(job_id, {"status": "done", "doi": body.doi, "result": result})
        finally:
            with _jobs_lock:
                _cancel_flags.pop(job_id, None)

    threading.Thread(target=run, name=f"doi-{job_id[:8]}", daemon=True).start()
    return {"ok": True, "jobId": job_id}


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict:
    """Stops sending this job's remaining pages to the provider. Pages
    already in flight finish and are saved; the job then ends normally
    with the rest listed in `cancelledPages`."""
    with _jobs_lock:
        flag = _cancel_flags.get(job_id)
        known = job_id in _jobs
    if flag is None:
        if known:
            return {"ok": True, "alreadyFinished": True}
        raise HTTPException(status_code=404, detail="Unknown job — the backend may have restarted.")
    flag.set()
    return {"ok": True}


@router.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    with _jobs_lock:
        job = _jobs.get(job_id)
        progress = _progress.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown job — the backend may have restarted.")
    return {**job, "progress": progress.snapshot() if progress else None}
