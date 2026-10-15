"""Titik masuk FastAPI. Jalankan: uvicorn app.main:app --reload"""

from __future__ import annotations

import json
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from .api import router
from .bootstrap import init_db, seed
from .config import CORS_ORIGINS
from .security import api_limiter


class JsonFormatter(logging.Formatter):
    """Log terstruktur (NFR-11)."""

    def format(self, record):
        base = {"t": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"), "lvl": record.levelname, "log": record.name, "msg": record.getMessage()}
        for k in ("run_id", "kind", "durasi_s", "sel", "path", "status", "ms", "method"):
            if hasattr(record, k):
                base[k] = getattr(record, k)
        if record.exc_info:
            base["exc"] = self.formatException(record.exc_info)
        return json.dumps(base, ensure_ascii=False)


_h = logging.StreamHandler()
_h.setFormatter(JsonFormatter())
logging.basicConfig(level=logging.INFO, handlers=[_h], force=True)
log = logging.getLogger("sempat.http")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    seed()
    yield


app = FastAPI(title="Sempat API", version="1.0.0", description="Uji kecukupan tempat evakuasi sementara (TES) tsunami Kota Bengkulu.", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def observe(request: Request, call_next):
    t0 = time.perf_counter()
    if request.url.path.startswith("/api/"):
        try:
            api_limiter.check(request.client.host if request.client else "?")
        except Exception as e:  # noqa: BLE001
            return JSONResponse(status_code=429, content={"error": e.detail})
    response = await call_next(request)
    ms = round((time.perf_counter() - t0) * 1000, 1)
    if request.url.path.startswith("/api/"):
        log.info("permintaan", extra={"method": request.method, "path": request.url.path, "status": response.status_code, "ms": ms})
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    return response


@app.exception_handler(StarletteHTTPException)
async def http_error(_: Request, exc: StarletteHTTPException):
    detail = exc.detail if isinstance(exc.detail, dict) else {"code": "galat", "message": str(exc.detail), "hint": ""}
    return JSONResponse(status_code=exc.status_code, content={"error": detail})


FIELD_LABEL = {"email": "Surel", "password": "Kata sandi", "name": "Nama", "role": "Peran"}


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    parts = []
    for e in exc.errors()[:5]:
        loc = ".".join(str(x) for x in e.get("loc", [])[1:])
        parts.append(f"{FIELD_LABEL.get(loc, loc) or 'masukan'}: {e.get('msg')}")
    return JSONResponse(
        status_code=422,
        content={"error": {"code": "masukan_tidak_sah", "message": "Masukan tidak sah. " + "; ".join(parts), "hint": "Periksa isian yang ditandai lalu kirim lagi."}},
    )


app.include_router(router)

# Sajikan antarmuka hasil build (frontend/dist) bila ada, untuk penyebaran satu wadah.
DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        if path.startswith("api/"):
            return JSONResponse(status_code=404, content={"error": {"code": "tidak_ditemukan", "message": "Alamat API tidak ditemukan.", "hint": "Lihat /docs untuk daftar alamat."}})
        f = DIST / path
        if path and f.is_file():
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
