"""ASGI entrypoint.

Everything real lives in the `app/` package (see app/__init__.py for the
layering). This file exists so the documented command keeps working
unchanged:

    uvicorn main:app --host 0.0.0.0 --port 8000
"""

from app.api.app_factory import create_app

app = create_app()
