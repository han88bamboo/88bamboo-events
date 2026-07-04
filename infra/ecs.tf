# ecs.tf — the ECS cluster, task definition, and Fargate service (plan §3).
#
# One always-on service (events-api) with a single task in a PUBLIC subnet and
# assign_public_ip=true, so it reaches Stripe/SES/S3/ECR outbound via the IGW
# with no NAT gateway. Inbound is ALB-only (task SG). The task's env is the
# production config block from plan §9 — secrets included as plain env vars
# (no Secrets Manager, the owner's documented choice).

resource "aws_cloudwatch_log_group" "events" {
  name              = "/ecs/events-api"
  retention_in_days = var.log_retention_days
  tags              = { Name = "events-api" }
}

resource "aws_ecs_cluster" "events" {
  name = "88bamboo-events"

  setting {
    name  = "containerInsights"
    value = "disabled" # keep CloudWatch cost down; enable if you want metrics
  }

  tags = { Name = "88bamboo-events" }
}

# Production environment for the container. POSTGRES_HOST/PORT come straight from
# the RDS instance so there is nothing to copy by hand. AWS_ACCESS_KEY_ID /
# SECRET are deliberately absent — the app falls back to the task IAM role
# (s3_images.py / mailer.py production paths, SPEC §A5/§A7).
locals {
  container_env = [
    { name = "PURPOSE", value = "production" },
    { name = "FLASK_DEBUG", value = "False" },
    { name = "HOST", value = "0.0.0.0" },
    { name = "PORT", value = tostring(var.container_port) },

    # Shared drinkxprod instance, but the events-only database + scoped user.
    { name = "POSTGRES_HOST", value = var.db_host },
    { name = "POSTGRES_PORT", value = tostring(var.db_port) },
    { name = "POSTGRES_DB", value = var.db_name },
    { name = "POSTGRES_USER", value = var.db_username },
    { name = "POSTGRES_PASSWORD", value = var.db_password },

    { name = "STRIPE_SECRET_KEY", value = var.stripe_secret_key },
    { name = "STRIPE_WEBHOOK_SECRET", value = var.stripe_webhook_secret },

    { name = "SHOPIFY_SHARED_SECRET", value = var.shopify_shared_secret },
    # MUST stay "false": the API is called DIRECTLY cross-origin (admin dashboard,
    # submission form, widget, Vercel SSR) and by Stripe's webhook — none of which
    # carry a Shopify App Proxy signature. Only the FRONTEND (events.88bamboo.co on
    # Vercel) sits behind the proxy and verifies signatures. Setting this "true"
    # here makes shopify_proxy.py's before_request 401 every non-/health request
    # (incl. the CORS OPTIONS preflight), breaking admin login and all API reads.
    { name = "SHOPIFY_PROXY_VERIFY", value = "false" },

    { name = "ADMIN_SESSION_SECRET", value = var.admin_session_secret },
    { name = "PUBLIC_EVENT_BASE_URL", value = var.public_event_base_url },

    { name = "AWS_REGION", value = var.region },
    { name = "S3_PUBLIC_BUCKET", value = aws_s3_bucket.images.bucket },

    { name = "SES_SENDER", value = var.ses_sender },
    { name = "ADMIN_NOTIFY_EMAIL", value = var.admin_notify_email },

    { name = "MAX_IMAGE_MB", value = tostring(var.max_image_mb) },
    { name = "ENABLE_SCHEDULER", value = var.enable_scheduler ? "true" : "false" },
    { name = "DIGEST_HOUR_UTC", value = tostring(var.digest_hour_utc) },
  ]
}

resource "aws_ecs_task_definition" "events" {
  family                   = "events-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.task_cpu)
  memory                   = tostring(var.task_memory)
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64" # images are built --platform linux/amd64
  }

  container_definitions = jsonencode([
    {
      name        = "events-api"
      image       = "${aws_ecr_repository.events.repository_url}:${var.image_tag}"
      essential   = true
      environment = local.container_env

      portMappings = [
        {
          containerPort = var.container_port
          protocol      = "tcp"
        }
      ]

      # Container-level health check mirrors the ALB check (curl is installed in
      # Dockerfile.backend's runner stage).
      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:${var.container_port}/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.events.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "events-api"
        }
      }
    }
  ])

  tags = { Name = "events-api" }
}

resource "aws_ecs_service" "events" {
  name            = "events-api"
  cluster         = aws_ecs_cluster.events.id
  task_definition = aws_ecs_task_definition.events.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  # Lets `aws ecs execute-command` shell into the task (schema load / debugging).
  enable_execute_command = true

  # Give the app time to connect to RDS and pass /health before the ALB culls it.
  health_check_grace_period_seconds = 60

  network_configuration {
    subnets          = var.public_subnet_ids
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = true # required for outbound with no NAT gateway
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.events.arn
    container_name   = "events-api"
    container_port   = var.container_port
  }

  # A manual `aws ecs update-service --force-new-deployment` re-pulls the same
  # ':latest' image WITHOUT changing the task-def revision, so it never conflicts
  # with Terraform. We do ignore desired_count so a console/CLI scale change (or
  # autoscaling later) isn't reverted on the next apply. Changing a secret in
  # terraform.tfvars still produces a new revision and deploys normally.
  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [aws_lb_listener_rule.events]
}
