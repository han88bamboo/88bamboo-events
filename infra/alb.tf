# alb.tf — attach events to the EXISTING Drink-X ALB (cost-sharing).
#
# Instead of a second ~$18-23/mo load balancer, we add three ADDITIVE resources
# to the Drink-X ALB's existing HTTPS listener:
#   1. a target group for the events Fargate task,
#   2. the events cert on the listener (SNI — a listener holds many certs),
#   3. a host-based rule: Host == events-api.88bamboo.co -> events target group.
#
# The drink-x.com rules are untouched. We reference the listener by ARN (via the
# data source in shared.tf); we do NOT import or manage the ALB, so this cannot
# corrupt Drink-X's own Terraform state.
#
# ⚠️ listener_rule_priority must not collide with a priority Drink-X's Terraform
# already uses on this listener. 100 is a safe default if Drink-X uses low
# numbers; bump it if `terraform apply` reports a duplicate-priority error.

resource "aws_lb_target_group" "events" {
  name        = "events-api-tg"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip" # Fargate awsvpc tasks register by ENI IP

  health_check {
    path                = "/health"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Name = "events-api-tg" }
}

# Add our cert to the shared listener (SNI). Referencing the *validation*
# resource forces this to wait until the cert is ISSUED (apply pass B).
resource "aws_lb_listener_certificate" "events" {
  listener_arn    = data.aws_lb_listener.https.arn
  certificate_arn = aws_acm_certificate_validation.api.certificate_arn
}

# Host-based routing: only requests for events-api.88bamboo.co hit our task.
resource "aws_lb_listener_rule" "events" {
  listener_arn = data.aws_lb_listener.https.arn
  priority     = var.listener_rule_priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.events.arn
  }

  condition {
    host_header {
      values = [var.api_domain]
    }
  }
}
