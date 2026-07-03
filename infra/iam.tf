# iam.tf — two roles (plan §3):
#
#   execution role — what ECS/Fargate uses to START the task: pull the image
#                    from ECR and write logs to CloudWatch.
#   task role      — what the APP uses at RUNTIME: put/get objects in the image
#                    bucket and send email via SES. In production s3_images.py
#                    creates the S3 client with NO explicit keys, so it picks up
#                    THIS role's credentials automatically (SPEC §A5).

# --- Trust policy shared by both roles: ECS tasks may assume them -----------
data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# --- Execution role: ECR pull + CloudWatch logs ----------------------------
resource "aws_iam_role" "execution" {
  name               = "events-ecs-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

# AWS-managed policy grants exactly ECR pull + CreateLogStream/PutLogEvents.
resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# --- Task role: S3 (image bucket) + SES send + ECS Exec (SSM) --------------
resource "aws_iam_role" "task" {
  name               = "events-ecs-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

data "aws_iam_policy_document" "task_permissions" {
  # S3: only the events image bucket, only the object operations the app uses.
  statement {
    sid    = "ImageBucketObjects"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
    ]
    resources = ["${aws_s3_bucket.images.arn}/*"]
  }

  # SES: send transactional email (v2 API SendEmail covers SendRawEmail usage).
  statement {
    sid    = "SendEmail"
    effect = "Allow"
    actions = [
      "ses:SendEmail",
      "ses:SendRawEmail",
    ]
    resources = ["*"]
  }

  # ECS Exec (aws ecs execute-command) — used for the one-time schema load /
  # debugging. Requires the SSM messages channel. Harmless if never used.
  statement {
    sid    = "EcsExecSSM"
    effect = "Allow"
    actions = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "task_permissions" {
  name   = "events-task-permissions"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task_permissions.json
}
