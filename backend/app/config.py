import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("SEMPAT_DATA_DIR", BASE_DIR / "var"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
(DATA_DIR / "uploads").mkdir(exist_ok=True)
(DATA_DIR / "reports").mkdir(exist_ok=True)

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{(DATA_DIR / 'sempat.db').as_posix()}")
# Render/Heroku memberi "postgres://" atau "postgresql://"; SQLAlchemy perlu nama driver.
for _p in ("postgres://", "postgresql://"):
    if DATABASE_URL.startswith(_p):
        DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len(_p):]
        break
SESSION_HOURS = float(os.getenv("SEMPAT_SESSION_HOURS", "8"))
COOKIE_SECURE = os.getenv("SEMPAT_COOKIE_SECURE", "0") == "1"
MAX_UPLOAD_BYTES = 100 * 1024 * 1024
CORS_ORIGINS = [o for o in os.getenv("SEMPAT_CORS_ORIGINS", "http://localhost:5173").split(",") if o]
PUBLIC_MIN_CELL_POP = 10
WORKERS = int(os.getenv("SEMPAT_WORKERS", "2"))
SAMPLE_DIR = BASE_DIR / "sample_data"
