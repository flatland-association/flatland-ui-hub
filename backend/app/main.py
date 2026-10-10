from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app import __version__
from app.config import settings
from app.api import sessions, websockets, overrides, hmi, policies, operator, study, sandbox

app = FastAPI(
    title="Flatland Dispatcher API",
    description="Human-in-the-Loop Dispatcher fuer Flatland Bahnsimulation",
    version=__version__,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router, prefix="/session", tags=["sessions"])
app.include_router(overrides.router, prefix="/session", tags=["overrides"])
app.include_router(sandbox.router, prefix="/session", tags=["sandbox"])
app.include_router(websockets.router, tags=["realtime"])
app.include_router(hmi.router, prefix="/session", tags=["hmi"])
app.include_router(policies.router, tags=["policies"])
app.include_router(operator.router, tags=["operator-model"])
app.include_router(study.router, tags=["study"])


@app.get("/health")
def health():
    return {"status": "ok"}


# Built Angular frontend (see /Dockerfile), copied in at image build time —
# absent in local dev, where the Angular dev server serves the UI instead.
FRONTEND_DIST = (
    Path(settings.frontend_dist)
    if settings.frontend_dist
    else Path(__file__).resolve().parent.parent / "static"
)

if FRONTEND_DIST.is_dir():

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_frontend(full_path: str):
        """Serve the built SPA same-origin: exact static assets by path,
        index.html for everything else (the app itself decides what to show
        based on the path — see AppComponent's show* getters)."""
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")

else:

    @app.get("/")
    def root():
        return {
            "name": "Flatland Dispatcher API",
            "version": __version__,
            "docs": "/docs",
        }
