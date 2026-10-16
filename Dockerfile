# Satu wadah: antarmuka hasil build disajikan oleh FastAPI.
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=web /web/dist /srv/frontend/dist
RUN useradd -r -u 10001 sempat && mkdir -p /data && chown -R sempat /data /srv/backend
USER sempat
ENV SEMPAT_DATA_DIR=/data
EXPOSE 8000
# Render menyetel PORT; bawaan 8000 untuk Docker Compose.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips=*"]
