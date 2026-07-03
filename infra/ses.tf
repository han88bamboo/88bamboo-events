# ses.tf — SES domain identity + DKIM for 88bamboo.co (plan §3, optional).
#
# SES is already out of the sandbox on this account, so no approval wait. This
# verifies the ROOT domain (covers events@88bamboo.co) and generates 3 DKIM
# tokens. Like the ACM cert, verification is via DNS you add in Shopify — the
# CNAMEs are emitted as the `ses_dkim_cnames` output (add them in Shopify DNS;
# they are additive and do not disturb existing M365/Mailchimp mail, plan §3).
#
# Created in apply pass A (targeted) so the DKIM CNAMEs are available to add
# alongside the ACM validation CNAME.

resource "aws_sesv2_email_identity" "domain" {
  count          = var.enable_ses ? 1 : 0
  email_identity = var.ses_domain

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}
