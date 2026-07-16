# variables.tf — inputs for the SHARED (ALB + RDS) deployment.
#
# We reuse the Drink-X ALB and the drinkxprod RDS instance (same account/VPC) to
# minimise marginal cost. Known Drink-X resource IDs (from the SPEC's resource
# dump) are defaults; secrets have NO defaults and must come from the git-ignored
# terraform.tfvars.

# ---------------------------------------------------------------------------
# Account / region / network (plan §3)
# ---------------------------------------------------------------------------
variable "account_id" {
  description = "AWS account ID (guardrail; apply aborts if creds resolve elsewhere)."
  type        = string
  default     = "851725425890"
}

variable "region" {
  description = "AWS region for all resources."
  type        = string
  default     = "ap-southeast-1"
}

variable "vpc_id" {
  description = "Shared VPC (Drink-X + events)."
  type        = string
  default     = "vpc-0d2c20f48f851c971"
}

variable "public_subnet_ids" {
  description = <<-EOT
    Public subnet IDs (>= 2, different AZs) to run the events Fargate task in
    (public so it gets an outbound path via the IGW — no NAT). List them with the
    CLI command in README.md.
  EOT
  type        = list(string)

  validation {
    condition     = length(var.public_subnet_ids) >= 2
    error_message = "Provide at least 2 public subnet IDs in different AZs."
  }
}

# ---------------------------------------------------------------------------
# Shared Drink-X ALB (attach an events host-rule to its HTTPS listener)
# ---------------------------------------------------------------------------
variable "existing_alb_name" {
  description = <<-EOT
    Name of the existing Drink-X ALB to attach to. Find it with:
      aws elbv2 describe-load-balancers --region ap-southeast-1 \
        --query "LoadBalancers[].{Name:LoadBalancerName,DNS:DNSName}" --output table
  EOT
  type        = string
}

variable "shared_https_listener_port" {
  description = "Port of the ALB's HTTPS listener to attach the events rule/cert to."
  type        = number
  default     = 443
}

variable "listener_rule_priority" {
  description = "Priority for the events host-based rule. Must not collide with an existing rule on the listener."
  type        = number
  default     = 100
}

variable "drinkx_alb_sg_id" {
  description = "Security group of the Drink-X ALB (task SG allows inbound from it)."
  type        = string
  default     = "sg-0d624dda1e1f4c7d9" # tf-drinkx-prod-alb-sg (SPEC dump)
}

# ---------------------------------------------------------------------------
# Shared drinkxprod RDS instance (events gets its own DB + user on it)
# ---------------------------------------------------------------------------
variable "db_host" {
  description = "Endpoint of the shared drinkxprod RDS instance."
  type        = string
  default     = "drinkxprod.cxoa4asusd0j.ap-southeast-1.rds.amazonaws.com" # SPEC dump
}

variable "db_port" {
  description = "Postgres port."
  type        = number
  default     = 5432
}

variable "db_name" {
  description = "Events database name to create on drinkxprod (isolated from Drink-X's DB)."
  type        = string
  default     = "events"
}

variable "db_username" {
  description = "Scoped events DB user (least privilege — cannot touch Drink-X's DB)."
  type        = string
  default     = "events_app"
}

variable "db_password" {
  description = "Password for the events_app user. Set in terraform.tfvars; also used in the DB bootstrap (README.md)."
  type        = string
  sensitive   = true
}

variable "drinkx_rds_sg_id" {
  description = "Security group protecting drinkxprod (opened to the task SG — see network.tf)."
  type        = string
  default     = "sg-05dba46a6d301d9b6" # tf-drinkx-prod-rds-sg (SPEC dump)
}

variable "manage_rds_ingress_rule" {
  description = <<-EOT
    Whether Terraform adds the 5432 ingress rule to the Drink-X RDS SG. Default
    false — add it by hand instead (network.tf explains why: inline-vs-standalone
    rule conflicts with Drink-X's own Terraform).
  EOT
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# ECS / Fargate (plan §3 — cluster 88bamboo-events, service events-api)
# ---------------------------------------------------------------------------
variable "task_cpu" {
  description = "Fargate task CPU units (256 = 0.25 vCPU)."
  type        = number
  default     = 256
}

variable "task_memory" {
  description = "Fargate task memory in MB."
  type        = number
  default     = 512
}

variable "desired_count" {
  description = "Number of events-api tasks. Keep at 1 — APScheduler jobs assume a single worker (plan §4B)."
  type        = number
  default     = 1
}

variable "container_port" {
  description = "Port the Flask/gunicorn container listens on."
  type        = number
  default     = 5000
}

variable "image_tag" {
  description = "ECR image tag the service runs."
  type        = string
  default     = "latest"
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for the task."
  type        = number
  default     = 30
}

# ---------------------------------------------------------------------------
# DNS / ACM / SES
# ---------------------------------------------------------------------------
variable "api_domain" {
  description = "Public API hostname (host-routed on the shared ALB)."
  type        = string
  default     = "events-api.88bamboo.co"
}

variable "ses_domain" {
  description = "Domain identity to verify in SES (root)."
  type        = string
  default     = "88bamboo.co"
}

variable "enable_ses" {
  description = "Create the SES domain identity + DKIM."
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# Application env (baked into the task definition, plan §9). Secrets: no defaults.
# ---------------------------------------------------------------------------
variable "stripe_secret_key" {
  description = "Stripe secret key (sk_test_ until go-live, then sk_live_)."
  type        = string
  sensitive   = true
}

variable "stripe_webhook_secret" {
  description = "Stripe webhook signing secret (whsec_)."
  type        = string
  sensitive   = true
}

variable "shopify_shared_secret" {
  description = "Shopify custom-app shared secret (App Proxy HMAC)."
  type        = string
  sensitive   = true
}

variable "admin_session_secret" {
  description = "Strong random secret signing the admin session token (plan §4A)."
  type        = string
  sensitive   = true
}

variable "public_event_base_url" {
  description = "Apex base for live/edit links in emails."
  type        = string
  default     = "https://www.88bamboo.co/a/events"
}

variable "ses_sender" {
  description = "From-address for transactional email."
  type        = string
  default     = "Events - 88 Bamboo <events@88bamboo.co>"
}

variable "admin_notify_email" {
  description = "Fallback recipient for admin new-submission alerts."
  type        = string
  default     = "events@88bamboo.co"
}

variable "max_image_mb" {
  description = "Max uploaded image size in MB."
  type        = number
  default     = 5
}

variable "enable_scheduler" {
  description = "Run the APScheduler safety jobs in the task."
  type        = bool
  default     = true
}

variable "digest_hour_utc" {
  description = "Hour (UTC) the daily pending-review digest is emailed."
  type        = number
  default     = 8
}
