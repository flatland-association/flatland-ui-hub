# Combined production image: builds the Angular frontend, then serves it
# same-origin from the FastAPI backend (see backend/app/main.py's
# FRONTEND_DIST static/SPA-fallback route). One container, no CORS, one URL.
#
# Build from the repo root:  docker build -t flatland-dispatcher .
# Run:                       docker run -p 8000:8000 flatland-dispatcher

# Angular CLI 22 requires Node >= 22.22.3 / 24.15.0 / 26.0.0 — node:20 (Render's
# earlier cache) is too old, hence node:24.
FROM node:24-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
# The Director's planner weights (3.4 MB). Resolved from `parents[2]` of
# goal_directed_policy.py, which is /app here, so next to ./app rather than in
# it. Left out, the A/B/C strategy tiles stay empty while everything else runs.
COPY backend/models ./models
COPY --from=frontend-build /app/frontend/dist/frontend/browser ./static

EXPOSE 8000
# Shell form (not exec-array) so $PORT expands — hosts like Render assign
# their own port at runtime; falls back to 8000 for local `docker run`.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
