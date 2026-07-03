# ecr.tf — the single backend image registry (plan §3).
#
# docker-build.sh / docker-push.sh push the events-api image here; the ECS task
# definition pulls "<repo_url>:<image_tag>". Create this early (apply pass A) so
# the image exists before the ECS service tries to start (README.md runbook).

resource "aws_ecr_repository" "events" {
  name                 = "be-88bamboo-events"
  image_tag_mutability = "MUTABLE" # 'latest' is re-pushed on every deploy

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = { Name = "be-88bamboo-events" }
}

# Keep only the last 10 images to control storage cost.
resource "aws_ecr_lifecycle_policy" "events" {
  repository = aws_ecr_repository.events.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}
