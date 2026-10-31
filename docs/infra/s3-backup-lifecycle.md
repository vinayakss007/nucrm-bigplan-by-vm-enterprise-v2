# S3 Backup Lifecycle Configuration

## Bucket Setup

Create a dedicated backup bucket with versioning:

```bash
aws s3api create-bucket \
  --bucket nucrm-backups-production \
  --region us-east-1

aws s3api put-bucket-versioning \
  --bucket nucrm-backups-production \
  --versioning-configuration Status=Enabled
```

## What the app does when the bucket is not there (#3258)

Until #3258 nothing in the repo could create a bucket: `lib/storage/s3.ts`,
`lib/backups/offsite.ts` and `app/api/tenant/files/route.ts` all wrote objects into a
name somebody had provisioned out-of-band, so the first upload on a fresh endpoint was a
bare `NoSuchBucket` — and on the presigned-PUT path the browser was the one that found out.

Every one of those writes now asks first (`lib/storage/ensure-bucket.ts`): `HeadBucket`,
and on a positive "absent" a `CreateBucket`. The answer is three-valued on purpose, because
the providers are not uniform: a *refused* `HEAD` is recorded as unverifiable and the write
proceeds — a role that may `PutObject` but not `HeadBucket` is a normal deployment, and a
managed provider that refuses `CreateBucket` outright (#2054) must not be turned into a
broken upload by a helper that reads "I can't tell" as "it is missing".

`npm run storage:buckets` is the operator version of the same question, with a write/read/
delete round trip so a bucket that exists but rejects your keys is reported as a failure.
Run it once per environment, after the `aws s3api create-bucket` above or instead of it.

## Lifecycle Policy

Apply this lifecycle policy to manage costs:

```json
{
  "Rules": [
    {
      "ID": "backup-lifecycle",
      "Status": "Enabled",
      "Filter": { "Prefix": "backups/" },
      "Transitions": [
        {
          "Days": 30,
          "StorageClass": "STANDARD_IA"
        },
        {
          "Days": 90,
          "StorageClass": "GLACIER"
        }
      ],
      "Expiration": {
        "Days": 365
      },
      "NoncurrentVersionExpiration": {
        "NoncurrentDays": 30
      }
    },
    {
      "ID": "wal-lifecycle",
      "Status": "Enabled",
      "Filter": { "Prefix": "wal/" },
      "Expiration": {
        "Days": 30
      }
    }
  ]
}
```

Apply with:

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket nucrm-backups-production \
  --lifecycle-configuration file://lifecycle.json
```

## Retention Strategy

| Type             | Hot (S3 Standard) | Warm (S3 IA) | Cold (Glacier) | Delete         |
| ---------------- | ----------------- | ------------ | -------------- | -------------- |
| Daily backups    | 30 days           | 30-90 days   | 90-365 days    | After 365 days |
| WAL segments     | 30 days           | —            | —              | After 30 days  |
| Weekly snapshots | 90 days           | 90-180 days  | 180-730 days   | After 2 years  |

## Cross-Region Replication

For disaster recovery, enable cross-region replication:

```bash
aws s3api put-bucket-replication \
  --bucket nucrm-backups-production \
  --replication-configuration '{
    "Role": "arn:aws:iam::ACCOUNT:role/nucrm-backup-replication",
    "Rules": [{
      "Status": "Enabled",
      "Destination": {
        "Bucket": "arn:aws:s3:::nucrm-backups-dr-us-west-2",
        "StorageClass": "STANDARD_IA"
      }
    }]
  }'
```

## IAM Policy (Least Privilege)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::nucrm-backups-production",
        "arn:aws:s3:::nucrm-backups-production/*"
      ]
    }
  ]
}
```

## Environment Variables

```env
S3_BACKUP_BUCKET=nucrm-backups-production
S3_BACKUP_REGION=us-east-1
S3_BACKUP_PREFIX=backups/
S3_WAL_PREFIX=wal/
BACKUP_ENCRYPTION_KEY=<64-char-hex>
```

## Monitoring

The `/api/system/backup-status` endpoint (superadmin) reports from the database
records, without touching object storage:

- `healthy` — a `status = 'completed'` backup exists and completed < 25 hours ago
- `last_backup` — that backup, with `size_bytes`, `storage_type`, and the
  `verified_ok` / `last_verified_at` written by `/api/cron/backup-verify`
- `last_failure` — the newest `status = 'failed'` row with a length-capped
  `error_excerpt`, so a failed dump stays visible even while an older success
  keeps `healthy` true (#2600)
- `total_backups`, `active_schedules` (deleted schedules excluded), and
  `next_scheduled` — the soonest pending run, not an arbitrary one
- `open_alerts` — unresolved rows of `backup_alerts`: `count`,
  `oldest_unresolved_at`, `by_type`. Before #2600 nothing could read this table
  at all, so nightly alert writes accumulated forever.

Proving a dump is *restorable* is `/api/cron/backup-verify`'s job rather than
this endpoint's: it restores into a scratch database and answers 5xx when the
restore fails, which is what makes `deploy/cron/run-cron.sh` report it.

Set up CloudWatch alarm:

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name nucrm-backup-missing \
  --metric-name backup_age_hours \
  --namespace NuCRM \
  --threshold 25 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --period 3600 \
  --statistic Maximum \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT:ops-alerts
```
