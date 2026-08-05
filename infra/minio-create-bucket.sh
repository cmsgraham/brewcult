#!/bin/sh
# BrewCult — one-shot MinIO bucket bootstrap (run by the minio-init service).
# Idempotent: `mc mb -p` succeeds if the bucket already exists.
set -eu

: "${S3_ENDPOINT:=http://minio:9000}"
: "${S3_BUCKET:=brewcult-media}"
: "${S3_ACCESS_KEY:=minioadmin}"
: "${S3_SECRET_KEY:=minioadmin}"

# Wait for MinIO to be ready
until mc alias set local "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" 2>/dev/null; do
  echo "Waiting for MinIO..."
  sleep 1
done

mc mb -p "local/$S3_BUCKET"

# Media objects are served straight from this origin by the browser (the API
# never proxies image bytes), so the bucket needs anonymous read. Keys are
# non-guessable, and nothing secret is ever stored here.
mc anonymous set download "local/$S3_BUCKET"

echo "Bucket ready: $S3_BUCKET (anonymous download enabled)"
