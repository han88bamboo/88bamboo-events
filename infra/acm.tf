# acm.tf — TLS certificate for events-api.88bamboo.co (plan §3).
#
# DNS lives in Shopify, not Route 53, so Terraform CANNOT create the validation
# record for you — you add it to Shopify DNS by hand. That is why apply is split
# in two (README.md runbook):
#
#   PASS A  terraform apply -target=aws_acm_certificate.api ...
#           -> cert created in PENDING_VALIDATION; the CNAME to add is emitted as
#              the `acm_validation_cname` output.
#   (you add that CNAME + the SES DKIM CNAMEs to Shopify DNS)
#   PASS B  terraform apply
#           -> aws_acm_certificate_validation waits for AWS to see the CNAME and
#              flip the cert to ISSUED, then the ALB HTTPS listener can use it.

resource "aws_acm_certificate" "api" {
  domain_name       = var.api_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = { Name = var.api_domain }
}

# Waits for the (externally-added) DNS validation to complete. Because we do NOT
# manage the Route 53 record, we pass no validation_record_fqdns — the resource
# simply polls until the certificate reaches ISSUED. In pass A this is skipped by
# the -target; in pass B it gates the HTTPS listener.
resource "aws_acm_certificate_validation" "api" {
  certificate_arn = aws_acm_certificate.api.arn

  timeouts {
    create = "45m" # generous window to add the CNAME in Shopify and let DNS propagate
  }
}
