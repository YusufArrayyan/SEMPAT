"""Autentikasi sesi cookie httpOnly, Argon2, kontrol peran, batas laju, dan galat seragam."""

from __future__ import annotations

import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .config import SESSION_HOURS
from .db import get_db
from .models import AuditLog, SessionToken, User

COOKIE_NAME = "sempat_sesi"
ROLE_RANK = {"peneliti": 1, "analis": 2, "admin": 3}
ROLE_LABEL = {"admin": "Admin", "analis": "Analis", "peneliti": "Peneliti"}

_ph = PasswordHasher()


class ApiError(HTTPException):
    """Galat seragam: kode, pesan yang dapat dibaca, dan petunjuk perbaikan."""

    def __init__(self, status: int, code: str, message: str, hint: str = ""):
        super().__init__(status_code=status, detail={"code": code, "message": message, "hint": hint})


def hash_password(pw: str) -> str:
    return _ph.hash(pw)


def verify_password(pw: str, h: str) -> bool:
    try:
        return _ph.verify(h, pw)
    except (VerifyMismatchError, InvalidHashError):
        return False


def create_session(db: Session, user: User) -> SessionToken:
    tok = SessionToken(
        token=secrets.token_urlsafe(32),
        user_id=user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=SESSION_HOURS),
    )
    db.add(tok)
    db.commit()
    return tok


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def current_user_optional(request: Request, db: Session = Depends(get_db)) -> User | None:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    s = db.get(SessionToken, token)
    if not s or _aware(s.expires_at) < datetime.now(timezone.utc):
        return None
    user = db.get(User, s.user_id)
    if not user or not user.active:
        return None
    return user


def current_user(user: User | None = Depends(current_user_optional)) -> User:
    if user is None:
        raise ApiError(401, "belum_masuk", "Sesi Anda tidak aktif atau sudah kedaluwarsa.", "Masuk kembali dengan surel dan kata sandi.")
    return user


def require_role(min_role: str):
    def dep(user: User = Depends(current_user)) -> User:
        if ROLE_RANK.get(user.role, 0) < ROLE_RANK[min_role]:
            raise ApiError(
                403,
                "akses_ditolak",
                f"Tindakan ini memerlukan peran {ROLE_LABEL[min_role]} atau lebih tinggi.",
                "Minta Admin mengubah peran akun Anda bila tindakan ini memang tugas Anda.",
            )
        return user

    return dep


def audit(db: Session, user: User | None, action: str, object_ref: str, detail: dict | None = None) -> None:
    db.add(AuditLog(user_id=user.id if user else None, user_email=user.email if user else None, action=action, object_ref=object_ref, detail=detail))


class RateLimiter:
    def __init__(self, limit: int, window_s: float):
        self.limit = limit
        self.window = window_s
        self.hits: dict[str, deque] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.monotonic()
        q = self.hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            raise ApiError(429, "terlalu_sering", "Terlalu banyak percobaan dalam waktu singkat.", "Tunggu satu menit, lalu coba lagi.")
        q.append(now)


login_limiter = RateLimiter(10, 60)
api_limiter = RateLimiter(600, 60)
