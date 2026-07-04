# network.tf — one new SG for the events task, plus an optional opening in the
# EXISTING Drink-X RDS SG so the task can reach the shared drinkxprod instance.
#
#   internet ─▶ [Drink-X ALB + its SG] ─443─▶ [events task_sg] ─5432─▶ [drinkxprod + its RDS SG]
#
# The ALB and RDS security groups already exist (Drink-X); we only reference them.

# --- Events Fargate task: inbound only from the Drink-X ALB SG --------------
# Outbound "anywhere" is how the task reaches Stripe/SES/S3/ECR (via its public
# IP + IGW, no NAT) and drinkxprod.
resource "aws_security_group" "task" {
  name        = "events-task-sg"
  description = "events-api Fargate task - in from the Drink-X ALB SG only, all out"
  vpc_id      = var.vpc_id

  ingress {
    description     = "App port from the shared (Drink-X) ALB"
    from_port       = var.container_port
    to_port         = var.container_port
    protocol        = "tcp"
    security_groups = [var.drinkx_alb_sg_id]
  }

  egress {
    description = "All outbound (Stripe/SES/S3/ECR via IGW, and drinkxprod)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "events-task-sg" }
}

# --- Open drinkxprod's RDS SG to the events task (OPTIONAL, default OFF) -----
# ⚠️ This adds a STANDALONE ingress rule to a security group that Drink-X's own
# Terraform very likely manages with INLINE ingress blocks. Mixing standalone +
# inline rules on the same SG causes perpetual diffs / rule clobbering across the
# two states. So this is off by default. Two safe ways to grant access:
#
#   (A) RECOMMENDED — add the rule by hand once (console or CLI), outside TF:
#       aws ec2 authorize-security-group-ingress \
#         --group-id <var.drinkx_rds_sg_id> \
#         --protocol tcp --port 5432 \
#         --source-group <events task SG id, from `terraform output task_security_group_id`> \
#         --region ap-southeast-1
#
#   (B) Only if the Drink-X RDS SG is NOT managed by inline rules elsewhere:
#       set manage_rds_ingress_rule = true and let TF create it below.
resource "aws_security_group_rule" "drinkx_rds_from_events" {
  count                    = var.manage_rds_ingress_rule ? 1 : 0
  type                     = "ingress"
  description              = "events-api task to drinkxprod (5432)"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = var.drinkx_rds_sg_id
  source_security_group_id = aws_security_group.task.id
}
