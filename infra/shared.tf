# shared.tf — read-only lookups of the EXISTING Drink-X infrastructure we attach
# to (cost-sharing on the same account/VPC). These are data sources only: we
# never manage the Drink-X ALB itself, just discover its ARN/DNS/listener so we
# can hang additive resources off it.

# The Drink-X internet-facing ALB. Found by name — get it with:
#   aws elbv2 describe-load-balancers --region ap-southeast-1 \
#     --query "LoadBalancers[].{Name:LoadBalancerName,DNS:DNSName}" --output table
data "aws_lb" "shared" {
  name = var.existing_alb_name
}

# The ALB's HTTPS:443 listener (terminates TLS for drink-x.com today). We add the
# events cert to it via SNI and a host-based rule for events-api.88bamboo.co.
# Assumes exactly one listener on 443; adjust var.shared_https_listener_port if not.
data "aws_lb_listener" "https" {
  load_balancer_arn = data.aws_lb.shared.arn
  port              = var.shared_https_listener_port
}
