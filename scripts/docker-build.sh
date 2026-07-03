#!/usr/bin/env bash
# docker-build.sh — build the events-api backend image (SPEC §D).
#
# Builds --platform linux/amd64 so an image built on Apple Silicon runs on AWS
# Fargate (X86_64). Tags :latest and :<git-short-sha>. Frontend is NOT built
# here — it ships via Vercel (plan §3).
#
# Usage:  bash scripts/docker-build.sh
set -euo pipefail

# Repo root = parent of this scripts/ dir, regardless of where it's invoked.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/backend"

ECR_REPO="be-88bamboo-events"

# CI provides GITHUB_SHA; locally fall back to the current git short hash.
if [[ -n "${GITHUB_SHA:-}" ]]; then
  TAG="${GITHUB_SHA:0:7}"
else
  TAG="$(git rev-parse --short HEAD)"
fi

echo "Building ${ECR_REPO}:latest and ${ECR_REPO}:${TAG} (linux/amd64)..."
docker image build \
  --platform linux/amd64 \
  -f Dockerfile.backend \
  -t "${ECR_REPO}:latest" \
  -t "${ECR_REPO}:${TAG}" \
  .

# Handoff artifact for docker-push.sh (which tag was just built).
echo "${TAG}" > "$ROOT_DIR/scripts/.last-build-tag"
echo "Built ${ECR_REPO}:${TAG}"
