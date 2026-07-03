# outputs.tf — what you need to wire up DNS and finish setup.

# --- DNS records to add in Shopify -----------------------------------------

output "acm_validation_cname" {
  description = "ACM DNS-validation record to add in Shopify DNS (CNAME name -> value). Add before apply pass B."
  value = {
    for o in aws_acm_certificate.api.domain_validation_options :
    o.resource_record_name => o.resource_record_value
  }
}

output "ses_dkim_cnames" {
  description = "SES DKIM CNAME records to add in Shopify DNS (name -> value). Empty when enable_ses=false."
  value = var.enable_ses ? {
    for token in aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens :
    "${token}._domainkey.${var.ses_domain}" => "${token}.dkim.amazonses.com"
  } : {}
}

output "api_alb_cname_target" {
  description = "Add a CNAME 'events-api.88bamboo.co' -> this value (the shared Drink-X ALB) in Shopify DNS."
  value       = data.aws_lb.shared.dns_name
}

# --- Core identifiers ------------------------------------------------------

output "shared_alb_dns_name" {
  description = "DNS name of the shared Drink-X ALB the events service is attached to."
  value       = data.aws_lb.shared.dns_name
}

output "db_endpoint" {
  description = "Shared drinkxprod endpoint the app connects to (events database + events_app user)."
  value       = "${var.db_host}:${var.db_port}/${var.db_name}"
}

output "task_security_group_id" {
  description = "Events task SG id — use it as the source-group when opening drinkxprod's RDS SG by hand (network.tf option A)."
  value       = aws_security_group.task.id
}

output "s3_bucket_name" {
  description = "Public image bucket name (goes into S3_PUBLIC_BUCKET)."
  value       = aws_s3_bucket.images.bucket
}

output "ecr_repository_url" {
  description = "ECR repo URL for docker-build.sh / docker-push.sh."
  value       = aws_ecr_repository.events.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name (for update-service --force-new-deployment)."
  value       = aws_ecs_cluster.events.name
}

output "ecs_service_name" {
  description = "ECS service name (for update-service --force-new-deployment)."
  value       = aws_ecs_service.events.name
}
