#!/usr/bin/env bash
# docker-push.sh — push the events-api image to ECR (SPEC §D).
#
# Logs in to ECR, then pushes the locally-built image under two tags:
# :<git-short-sha> and :latest (the ECS task definition runs :latest).
#
# Usage:  bash scripts/docker-push.sh
# Needs:  AWS credentials with ECR push permission; docker-build.sh run first.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

AWS_REGION="${AWS_DEFAULT_REGION:-ap-southeast-1}"
ACCOUNT_ID="851725425890"
ECR_REPO="be-88bamboo-events"
ECR_HOST="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# Recover the tag written by docker-build.sh (fall back to current git hash).
if [[ -f "$ROOT_DIR/scripts/.last-build-tag" ]]; then
  TAG="$(cat "$ROOT_DIR/scripts/.last-build-tag")"
else
  TAG="$(git -C "$ROOT_DIR" rev-parse --short HEAD)"
fi

echo "Logging in to ECR ${ECR_HOST}..."
aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin "${ECR_HOST}"

echo "Tagging and pushing ${ECR_REPO}:${TAG} and :latest..."
docker tag "${ECR_REPO}:${TAG}"    "${ECR_HOST}/${ECR_REPO}:${TAG}"
docker tag "${ECR_REPO}:latest"    "${ECR_HOST}/${ECR_REPO}:latest"

docker push "${ECR_HOST}/${ECR_REPO}:${TAG}"
docker push "${ECR_HOST}/${ECR_REPO}:latest"

echo "Pushed ${ECR_HOST}/${ECR_REPO}:{${TAG},latest}"
echo
echo "Next — roll the service onto the new image:"
echo "  aws ecs update-service \\"
echo "    --cluster 88bamboo-events \\"
echo "    --service events-api \\"
echo "    --force-new-deployment \\"
echo "    --region ${AWS_REGION}"
