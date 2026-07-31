-- Rollback 0032_rename_announcement_body_to_content: Revert column rename
ALTER TABLE announcements RENAME COLUMN content TO body;
