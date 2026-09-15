# UpCloud Managed Object Storage: `CreateBucket` → AccessDenied, buckets absent (PP-018)

**Severity:** MEDIUM — off-box durability missing
**Area:** Infra / deploy · Data integrity
**Register:** [`docs/infra/PREPROD-ISSUE-REGISTER.md` → PP-018](../../../docs/infra/PREPROD-ISSUE-REGISTER.md)

## Summary

The UpCloud managed object-storage credentials cannot create buckets (`AccessDenied`), and the expected
buckets do not exist. The stack is currently functional because local MinIO is the active S3 endpoint,
but the off-box durability path (backups/attachments leaving the VM) is not in place.

## Steps to reproduce

```bash
aws s3api create-bucket --endpoint-url <upcloud-endpoint> --bucket nucrm-backups --region <region>
# -> An error occurred (AccessDenied) when calling the CreateBucket operation
docker exec -i nucrm-minio mc ls local/            # MinIO works; managed storage does not
```

## Expected vs actual

- **Expected:** buckets exist on UpCloud managed storage and the app/backup can write to them.
- **Actual:** `AccessDenied`; buckets absent.

## Why

The provisioning user lacks `s3:CreateBucket` (or equivalent) rights; this is an account-permission
issue, not an application bug.

## Proposed fix

Grant the object-storage user bucket admin rights (or pre-create the buckets and grant object-level
access), verify with `aws s3 ls`, then point the backup target at the managed endpoint and re-run
`deploy/scripts/backup.sh`. Until then, treat MinIO-only storage as a single point of failure in the DR
runbook.
