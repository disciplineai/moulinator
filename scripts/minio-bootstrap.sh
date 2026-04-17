#!/bin/sh
# =========================================================================
# moulinator MinIO bootstrap
# =========================================================================
# Runs once as the `createbuckets` job on first boot of the control stack.
# Idempotent: safe to re-run.
#
# Does three things:
#   1. Creates the three buckets with their lifecycle rules.
#   2. Writes a bucket-scoped IAM policy (moulinator-app).
#   3. Creates a scoped user (MINIO_ACCESS_KEY/MINIO_SECRET_KEY) and attaches
#      the policy. Root creds stay isolated to admin-plane use only.
#
# Env vars required (injected by compose):
#   MINIO_ROOT_USER, MINIO_ROOT_PASSWORD,
#   MINIO_ACCESS_KEY, MINIO_SECRET_KEY,
#   MINIO_BUCKET_WORKSPACES, MINIO_BUCKET_LOGS, MINIO_BUCKET_JUNIT
# =========================================================================

set -eu

: "${MINIO_ROOT_USER:?}"
: "${MINIO_ROOT_PASSWORD:?}"
: "${MINIO_ACCESS_KEY:?}"
: "${MINIO_SECRET_KEY:?}"
: "${MINIO_BUCKET_WORKSPACES:?}"
: "${MINIO_BUCKET_LOGS:?}"
: "${MINIO_BUCKET_JUNIT:?}"

mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

# --- buckets + lifecycle ----------------------------------------------------
mc mb --ignore-existing "local/$MINIO_BUCKET_WORKSPACES"
mc mb --ignore-existing "local/$MINIO_BUCKET_LOGS"
mc mb --ignore-existing "local/$MINIO_BUCKET_JUNIT"

mc ilm rule add --expire-days 1  "local/$MINIO_BUCKET_WORKSPACES" || true
mc ilm rule add --expire-days 30 "local/$MINIO_BUCKET_LOGS"       || true
mc ilm rule add --expire-days 30 "local/$MINIO_BUCKET_JUNIT"      || true

# --- scoped policy ----------------------------------------------------------
cat > /tmp/moulinator-app.json <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": [
        "arn:aws:s3:::${MINIO_BUCKET_WORKSPACES}",
        "arn:aws:s3:::${MINIO_BUCKET_LOGS}",
        "arn:aws:s3:::${MINIO_BUCKET_JUNIT}"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": [
        "arn:aws:s3:::${MINIO_BUCKET_WORKSPACES}/*",
        "arn:aws:s3:::${MINIO_BUCKET_LOGS}/*",
        "arn:aws:s3:::${MINIO_BUCKET_JUNIT}/*"
      ]
    }
  ]
}
POLICY

mc admin policy create local moulinator-app /tmp/moulinator-app.json \
  || mc admin policy update local moulinator-app /tmp/moulinator-app.json

# --- scoped user + attach policy --------------------------------------------
mc admin user add      local "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" \
  || mc admin user password local "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY"

mc admin policy attach local moulinator-app --user "$MINIO_ACCESS_KEY" || true

echo "bucket + app-user bootstrap complete"
