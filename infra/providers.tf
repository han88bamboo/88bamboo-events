# providers.tf — AWS provider configuration.
#
# allowed_account_ids is a guardrail: if the credentials in the shell resolve to
# a DIFFERENT account than 851725425890, Terraform aborts before touching
# anything. This prevents an accidental apply into the wrong AWS account.

provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = {
      Project   = "88bamboo-events"
      Component = "backend"
      ManagedBy = "terraform"
    }
  }
}
