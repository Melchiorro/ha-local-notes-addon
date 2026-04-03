#!/bin/bash
echo "Starting Home Notes Add-on..."
cd /app
exec python3 -m uvicorn app.main:app --host 0.0.0.0 --port 15026