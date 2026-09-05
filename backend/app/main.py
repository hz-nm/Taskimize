"""FastAPI application entrypoint."""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .database import UPLOAD_DIR, init_db
from .routers import edges, projects, sources, tasks


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="Task Optimization System",
    description="Single-user task graph: tasks as nodes, `next` / `blocked_by` links as edges.",
    version="1.0.0",
    lifespan=lifespan,
)

# Single-user, locally hosted, no auth — the frontend origin varies by how you run
# it (Vite dev server, built static bundle, another host), so allow it broadly.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tasks.router)
app.include_router(edges.router)
app.include_router(projects.router)
app.include_router(sources.router)

# Uploaded source files, served back under /files (reached via the frontend's
# existing /api proxy as /api/files/...).
app.mount("/files", StaticFiles(directory=UPLOAD_DIR), name="files")


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}
