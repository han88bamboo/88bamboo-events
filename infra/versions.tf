# versions.tf — Terraform + provider version pins.
#
# The AWS provider is on the 6.x line (latest 6.52.0, June 2026). Per the plan's
# "~> 5.x or newest stable" instruction we pin the newest stable major. Every
# resource in this config is stable and identical across 5.x/6.x, so bumping the
# minor is safe; the ~> constraint allows 6.x minor/patch upgrades but not 7.0.

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # -------------------------------------------------------------------------
  # STATE: local by default (see infra/README.md — "State" for the rationale).
  # The state file contains secrets (DB password + Stripe keys live as plain
  # ECS env, plan §9), so it is git-ignored and must not be committed or shared.
  #
  # To move to a shared S3 backend later, create the bucket + DynamoDB lock
  # table first, then uncomment and `terraform init -migrate-state`:
  #
  # backend "s3" {
  #   bucket         = "88bamboo-events-tfstate"
  #   key            = "events-backend/terraform.tfstate"
  #   region         = "ap-southeast-1"
  #   dynamodb_table = "88bamboo-events-tflock"
  #   encrypt        = true
  # }
  # -------------------------------------------------------------------------
}
