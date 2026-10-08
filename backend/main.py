"""Entry point kept so the usual command still works:

    cd backend
    uvicorn main:app --reload

The application itself lives in the `app` package.
"""

from app.main import app

__all__ = ["app"]
