import os
import uuid
import json
import shutil
import mimetypes
from datetime import datetime
from fastapi import FastAPI, Request, UploadFile, File, HTTPException, Query
from sqlalchemy import create_engine, text
from fastapi.responses import FileResponse

app = FastAPI()

@app.middleware("http")
async def add_ingress_path_header(request: Request, call_next):
    root_path = request.headers.get("x-ingress-path", "")
    if root_path:
        request.scope["root_path"] = root_path
    response = await call_next(request)
    return response

DB_PATH = "/data/notes.db"
UPLOAD_DIR = "/data/images"

if not os.path.exists(UPLOAD_DIR):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    os.chmod(UPLOAD_DIR, 0o777)

engine = create_engine(f"sqlite:///{DB_PATH}")

with engine.connect() as conn:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            images TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """))
    conn.commit()

# --- API ---

@app.get("/api/notes")
async def get_notes():
    with engine.connect() as conn:
        result = conn.execute(text("SELECT id, content, images, created_at FROM notes ORDER BY created_at DESC"))
        return [{
            "id": r[0],
            "content": r[1],
            "images": json.loads(r[2] or "[]"),
            "created_at": r[3]
        } for r in result]

@app.post("/api/notes/upload")
async def upload_image(file: UploadFile = File(...)):
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    unique_filename = f"{timestamp}_{uuid.uuid4().hex[:8]}_{file.filename}"
    file_path = os.path.join(UPLOAD_DIR, unique_filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    os.chmod(file_path, 0o644)
    return {"url": f"images/{unique_filename}"}

@app.delete("/api/notes/upload")
async def delete_uploaded_file(path: str = Query(...)):
    filename = os.path.basename(path)
    full_path = os.path.join(UPLOAD_DIR, filename)
    if os.path.exists(full_path):
        try:
            os.remove(full_path)
            return {"status": "deleted"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    raise HTTPException(status_code=404, detail="File not found")

@app.post("/api/notes")
async def add_note(request: Request):
    data = await request.json()
    with engine.connect() as conn:
        conn.execute(
            text("INSERT INTO notes (content, images) VALUES (:c, :i)"),
            {"c": data["content"], "i": json.dumps(data.get("images", []))}
        )
        conn.commit()
    return {"status": "ok"}

@app.put("/api/notes/{note_id}")
async def update_note(note_id: int, request: Request):
    data = await request.json()
    with engine.connect() as conn:
        check = conn.execute(text("SELECT id FROM notes WHERE id = :id"), {"id": note_id}).fetchone()
        if not check:
            raise HTTPException(status_code=404, detail="Note not found")
        conn.execute(
            text("UPDATE notes SET content = :c, images = :i WHERE id = :id"),
            {"c": data["content"], "i": json.dumps(data.get("images", [])), "id": note_id}
        )
        conn.commit()
    return {"status": "updated"}

@app.delete("/api/notes/{note_id}")
async def delete_note(note_id: int):
    with engine.connect() as conn:
        result = conn.execute(text("SELECT images FROM notes WHERE id = :id"), {"id": note_id}).fetchone()
        if result and result[0]:
            images = json.loads(result[0])
            for img_path in images:
                filename = os.path.basename(img_path)
                full_path = os.path.join(UPLOAD_DIR, filename)
                if os.path.exists(full_path):
                    os.remove(full_path)
        conn.execute(text("DELETE FROM notes WHERE id = :id"), {"id": note_id})
        conn.commit()
        return {"status": "ok"}
        
@app.get("/api/config")
async def get_config():
    options_path = "/data/options.json"
    if os.path.exists(options_path):
        with open(options_path, "r") as f:
            return json.load(f)
    return {"show_admin_tools": False}

# --- TECH ---

@app.get("/api/check_files")
async def check_files():
    files = os.listdir(UPLOAD_DIR) if os.path.exists(UPLOAD_DIR) else "Folder not found"
    return {
        "upload_dir": UPLOAD_DIR,
        "exists": os.path.exists(UPLOAD_DIR),
        "files_found": files,
        "total_files": len(files) if isinstance(files, list) else 0
    }

@app.get("/api/cleanup_images")
async def cleanup_images(confirm: bool = Query(False)):
    all_files = os.listdir(UPLOAD_DIR) if os.path.exists(UPLOAD_DIR) else []
    used_images = set()
    with engine.connect() as conn:
        result = conn.execute(text("SELECT images FROM notes"))
        for row in result:
            if row[0]:
                image_list = json.loads(row[0])
                for img_path in image_list:
                    used_images.add(os.path.basename(img_path))
    
    orphaned_files = [f for f in all_files if f not in used_images]
    if not confirm:
        return {"status": "scan", "orphaned_count": len(orphaned_files), "files": orphaned_files}
    
    for filename in orphaned_files:
        os.remove(os.path.join(UPLOAD_DIR, filename))
    return {"status": "deleted", "count": len(orphaned_files)}

# --- STATIC & IMAGES ---

base_path = os.path.dirname(os.path.abspath(__file__))

@app.get("/images/{file_name}")
async def get_image(file_name: str):
    file_path = os.path.join(UPLOAD_DIR, file_name)
    if os.path.exists(file_path):
        mime_type, _ = mimetypes.guess_type(file_path)
        return FileResponse(file_path, media_type=mime_type or "image/jpeg")
    raise HTTPException(status_code=404)

@app.get("/{file_path:path}")
async def serve_static(file_path: str):
    if not file_path or file_path == "/":
        file_path = "index.html"
    
    if file_path.startswith("api/"):
        raise HTTPException(status_code=404)

    full_path = os.path.join(base_path, "static", file_path)
    if os.path.exists(full_path) and os.path.isfile(full_path):
        mime_type, _ = mimetypes.guess_type(full_path)
        return FileResponse(full_path, media_type=mime_type)
    
    index_path = os.path.join(base_path, "static", "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path, media_type="text/html")
    raise HTTPException(status_code=404)