-- NuCRM — Database Initialization
-- This runs once on first container start

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create application schema (Drizzle will manage tables)
-- This ensures the search path is correct
SET search_path TO public;

-- Performance: ensure stats collection is enabled
ALTER SYSTEM SET track_activities = on;
ALTER SYSTEM SET track_counts = on;
ALTER SYSTEM SET track_io_timing = on;
