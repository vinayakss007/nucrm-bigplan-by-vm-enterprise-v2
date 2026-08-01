-- Rollback 0010_rename_invitations_role: Revert column rename
ALTER TABLE invitations RENAME COLUMN role_slug TO "role";
