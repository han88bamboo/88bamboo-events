# s3.tf — the PUBLIC image bucket (plan §3 / SPEC §A5).
#
# The app stores direct virtual-hosted object URLs and serves images straight
# from S3 (no CloudFront). backend/s3_images.py does put_object WITHOUT an ACL,
# so public-read comes from the bucket POLICY below — the modern pattern now
# that S3 disables ACLs and blocks public access by default (provider v4+).
#
# Four resources, in the required order:
#   1. aws_s3_bucket                    — the bucket
#   2. aws_s3_bucket_ownership_controls — BucketOwnerEnforced (ACLs disabled)
#   3. aws_s3_bucket_public_access_block— all four flags FALSE (allow a public policy)
#   4. aws_s3_bucket_policy             — public s3:GetObject on every object

resource "aws_s3_bucket" "images" {
  bucket = "88bamboo-events-images"
  tags   = { Name = "88bamboo-events-images" }
}

# ACLs off — object ownership is enforced to the bucket owner. put_object with no
# ACL is exactly what s3_images.py does; access is governed solely by the policy.
resource "aws_s3_bucket_ownership_controls" "images" {
  bucket = aws_s3_bucket.images.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# This bucket is intentionally public-read, so every block is FALSE. In
# particular BlockPublicPolicy=false and RestrictPublicBuckets=false are required
# for the public bucket policy below to take effect.
resource "aws_s3_bucket_public_access_block" "images" {
  bucket                  = aws_s3_bucket.images.id
  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

# CORS so the browser can load images cross-origin (the apex pages + widget).
resource "aws_s3_bucket_cors_configuration" "images" {
  bucket = aws_s3_bucket.images.id
  cors_rule {
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["*"]
    allowed_headers = ["*"]
    max_age_seconds = 3000
  }
}

# Public read of objects only (never ListBucket — no directory browsing).
resource "aws_s3_bucket_policy" "images_public_read" {
  bucket = aws_s3_bucket.images.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PublicReadGetObject"
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.images.arn}/*"
    }]
  })

  # The policy can only be written once the public-access-block permits it.
  depends_on = [aws_s3_bucket_public_access_block.images]
}
