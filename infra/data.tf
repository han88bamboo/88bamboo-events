# data.tf — read-only lookups.
#
# We only *validate* the VPC exists here; subnet IDs are supplied explicitly as
# variables rather than auto-discovered, because reliably classifying an existing
# VPC's subnets as public vs private requires walking route tables (there is no
# guaranteed tag convention). README.md gives the CLI command to list them.

data "aws_vpc" "this" {
  id = var.vpc_id
}

# Current account/region — used to build the ECR registry host and ARNs.
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
