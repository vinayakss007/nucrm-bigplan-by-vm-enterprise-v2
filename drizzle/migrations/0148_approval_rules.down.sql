-- 0148 rollback: remove the persisted approval-rules table.
--
-- No other table references approval_rules (approval_requests.rule_id is
-- deliberately free text), so dropping it restores the pre-0148 state where
-- the Approval Rules tab had no storage. The policy and indexes go with it.
-- Safe to re-run.

DROP TABLE IF EXISTS "approval_rules";
