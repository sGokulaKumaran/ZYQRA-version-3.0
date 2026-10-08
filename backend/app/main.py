"""Application factory.  Run from the backend folder:  uvicorn main:app --reload"""

from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .ai import AIError, AIUnavailable, engine
from .config import settings
from .database import init_db
from .routers import auth, chats, dashboard, flashcards, notes, planner, quiz, system

logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(name)s - %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    # Warm the provider model lists without delaying startup.
    threading.Thread(target=engine.discover, daemon=True).start()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, version=__version__, lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(AIError)
    async def ai_error(_: Request, exc: AIError):
        headers = {}
        if isinstance(exc, AIUnavailable) and exc.retry_in:
            headers["Retry-After"] = str(exc.retry_in)
        return JSONResponse(status_code=503, content={"detail": str(exc)}, headers=headers)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_: Request, exc: RequestValidationError):
        # One readable sentence instead of pydantic's error list.
        first = exc.errors()[0] if exc.errors() else {}
        field = str(first.get("loc", ["", ""])[-1]).replace("_", " ").capitalize()
        message = str(first.get("msg", "Invalid request")).removeprefix("Value error, ")
        named = message if message.lower().startswith(field.lower()) else f"{field}: {message}"
        return JSONResponse(status_code=422, content={"detail": named if field else message})

    for module in (auth, chats, quiz, flashcards, notes, planner, dashboard, system):
        app.include_router(module.router)

    @app.get("/", include_in_schema=False)
    def root():
        return {"name": settings.app_name, "version": __version__, "docs": "/docs"}

    return app


app = create_app()
