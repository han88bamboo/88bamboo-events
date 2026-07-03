# events backend — Terraform (infra/)

Self-contained Terraform for the **88 Bamboo Events backend only**. The frontend
is on Vercel and is **not** managed here (plan §3).

Account `851725425890` · region `ap-southeast-1` · VPC `vpc-0d2c20f48f851c971`.

**Cost-sharing variant:** to minimise marginal cost, events **reuses the existing
Drink-X ALB and the drinkxprod RDS instance** (same account + VPC) instead of
standing up its own. It gets its own ECS service, task, image bucket, ECR repo,
IAM roles, ACM cert, and — on the shared RDS instance — its own isolated
**database + scoped user**. Marginal cost ≈ **$14–16/mo** (see below).

> Trade-off you accepted: events shares blast radius with Drink-X's DB and ALB.
> The `events_app` user is scoped to the `events` database only, but the two
> products now sit on one 2 GB `db.t4g.small` and one load balancer.

---

## What each file does (plain language)

| File | What it creates / does |
|---|---|
| `versions.tf` | Terraform ≥1.6, AWS provider `~> 6.0`. Local state (holds secrets → git-ignored). |
| `providers.tf` | Region + **account-ID guardrail**; default tags. |
| `variables.tf` | All inputs. Drink-X resource IDs are defaults (from the SPEC dump); secrets have none. |
| `terraform.tfvars.example` | Copy to `terraform.tfvars` (git-ignored) and fill in. |
| `data.tf` | Validates the VPC; reads account/region. |
| `shared.tf` | **Reads** the existing Drink-X ALB + its HTTPS listener (data sources only — never manages them). |
| `network.tf` | Events task SG (in from the Drink-X ALB SG only); optional/off-by-default opening of the Drink-X RDS SG. |
| `s3.tf` | The **public** image bucket (bucket + ownership-controls + public-access-block + public-read policy) + CORS. |
| `ecr.tf` | `be-88bamboo-events` image repo. |
| `iam.tf` | Execution role (ECR pull + logs); task role (S3 + SES + ECS Exec). |
| `acm.tf` | ACM cert for `events-api.88bamboo.co`; waits for the CNAME you add in Shopify. |
| `alb.tf` | **Additive** target group + listener cert + host-based rule on the shared ALB. |
| `ecs.tf` | Log group, `88bamboo-events` cluster, `events-api` task def (env points at the events DB on drinkxprod), Fargate service (public subnet, `assign_public_ip=true`). |
| `ses.tf` | Optional SES domain identity for `88bamboo.co` + DKIM. |
| `outputs.tf` | Shared ALB DNS, ACM validation CNAME, DB endpoint, task SG id, S3 bucket, ECR URL, DKIM CNAMEs. |

### Inputs you must supply
- `public_subnet_ids` — ≥2 public subnets to run the task in:
  ```bash
  aws ec2 describe-route-tables --region ap-southeast-1 \
    --filters Name=vpc-id,Values=vpc-0d2c20f48f851c971 \
    --query "RouteTables[?Routes[?GatewayId!=null && starts_with(GatewayId,'igw-')]].Associations[].SubnetId" \
    --output text
  ```
- `existing_alb_name` — the Drink-X ALB:
  ```bash
  aws elbv2 describe-load-balancers --region ap-southeast-1 \
    --query "LoadBalancers[].{Name:LoadBalancerName,DNS:DNSName}" --output table
  ```
- Secrets in `terraform.tfvars` (`db_password` for `events_app`, Stripe, Shopify, admin session).

### State — local or S3?
**Local**, git-ignored (state holds secrets — DB password + Stripe keys are plain
ECS env per plan §9). S3-backend upgrade path is in `versions.tf`.

---

## Step 0 — Bootstrap the events database on drinkxprod (once, by hand)

Terraform can't do this: drinkxprod is private, and TF on your laptop can't reach
it. Run this from a host **inside the VPC** that can reach drinkxprod — e.g. the
existing Drink-X EC2 box (`ec2-47-129-217-130`) — connecting as the **master**
user:

```sql
-- as the drinkxprod master user:
CREATE DATABASE events;
CREATE USER events_app WITH PASSWORD 'MATCH_terraform.tfvars_db_password';
GRANT ALL PRIVILEGES ON DATABASE events TO events_app;

\connect events
-- PG15: the public schema is not writable by non-owners by default.
GRANT ALL ON SCHEMA public TO events_app;
-- Extensions need rds_superuser (the master user has it); create them now so the
-- app's schema.sql (CREATE EXTENSION IF NOT EXISTS ...) is a no-op for events_app.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
```

Then apply the app schema as `events_app` (from that same in-VPC host):

```bash
psql "host=drinkxprod.cxoa4asusd0j.ap-southeast-1.rds.amazonaws.com port=5432 \
      dbname=events user=events_app sslmode=require" -f database/schema.sql
# (optional) seed the admin user — see database/README.md
```

`events_app` can only touch the `events` database — it has no rights on Drink-X's DB.

---

## Step 1 — Open drinkxprod's SG to the events task

Default is **manual** (safer — avoids a cross-state SG-rule conflict; see
`network.tf`). After the first apply you'll have the task SG id:

```bash
aws ec2 authorize-security-group-ingress \
  --group-id sg-05dba46a6d301d9b6 \
  --protocol tcp --port 5432 \
  --source-group "$(terraform output -raw task_security_group_id)" \
  --region ap-southeast-1
```

(Or set `manage_rds_ingress_rule = true` only if the Drink-X RDS SG is *not*
managed with inline rules by Drink-X's own Terraform.)

---

## Step 2 — Apply (two passes, with the Shopify-DNS pause)

DNS for `88bamboo.co` is in **Shopify**, not Route 53, so Terraform can't create
the ACM/SES validation records — you add them by hand mid-apply.

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars   # fill in subnet IDs, ALB name, secrets
terraform init && terraform fmt -check && terraform validate
```

### Pass A — create the cert + SES identity + image repo
```bash
terraform apply \
  -target=aws_acm_certificate.api \
  -target=aws_sesv2_email_identity.domain \
  -target=aws_ecr_repository.events
terraform output acm_validation_cname   # 1 CNAME
terraform output ses_dkim_cnames        # 3 CNAMEs
```

### ⏸ PAUSE — add records in Shopify Admin → Settings → Domains → manage DNS
- The **1 ACM validation CNAME** (name → value).
- The **3 SES DKIM CNAMEs** (additive; don't affect existing M365/Mailchimp mail).
- Wait for propagation; confirm ACM is **Issued**:
  ```bash
  aws acm list-certificates --region ap-southeast-1 \
    --query "CertificateSummaryList[?DomainName=='events-api.88bamboo.co']"
  ```

### Build & push the image
```bash
cd .. && bash scripts/docker-build.sh && bash scripts/docker-push.sh && cd infra
```

### Pass B — full apply (cert validates; the shared-ALB rule + ECS come up)
```bash
terraform apply
```

### ⏸ Add the API's DNS record in Shopify
Add `events-api.88bamboo.co` **CNAME → `terraform output -raw api_alb_cname_target`**
(the shared Drink-X ALB's DNS name). Then verify:
```bash
curl -i https://events-api.88bamboo.co/health   # expect HTTP 200
```

---

## Redeploying the backend later (SPEC §D)

```bash
bash scripts/docker-build.sh          # linux/amd64, tag :latest + :<sha>
bash scripts/docker-push.sh           # push to ECR
aws ecs update-service \
  --cluster 88bamboo-events \
  --service events-api \
  --force-new-deployment \
  --region ap-southeast-1
```

---

## Rough monthly cost — MARGINAL (what adding events costs on top of Drink-X)

| Item | Assumption | ~Monthly |
|---|---|---|
| ALB | **shared** — no new load balancer | **$0** |
| RDS | **shared** drinkxprod — new DB + user, no new instance | **$0** |
| Fargate | 1 task, 0.25 vCPU / 0.5 GB, 24×7 (new compute — not shareable) | **$9–12** |
| S3 | a few GB + light requests | **$1–2** |
| ECR | <1 GB stored | **<$1** |
| CloudWatch Logs | 30-day retention, low volume | **$1–2** |
| Data transfer | light | **$1–3** |
| **Marginal total** | | **≈ $14–16 / month** |

vs. **~$50/mo** for the fully-isolated variant (own ALB ~$20 + own RDS ~$18 +
Fargate ~$11 + misc). Sharing the ALB + RDS removes the two fixed costs; the
irreducible marginal cost is the Fargate task for the new app. SES is
pay-per-use (~$0.10 / 1,000 emails); ACM certs are free.

> If you later want events on its own RDS (isolation), the previous variant is in
> git history — restore `rds.tf`, revert `variables.tf`/`alb.tf`/`network.tf` to
> the own-ALB versions, and add ~$38/mo.
