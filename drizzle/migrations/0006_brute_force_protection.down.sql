-- Down Migration: 0006_brute_force_protection
DROP TABLE IF EXISTS login_blocks;
DROP TABLE IF EXISTS login_attempts;
