-- Migration: Add stage_entered_at column to deals table
-- Generated: 2026-06-13

ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "stage_entered_at" timestamp with time zone DEFAULT now();
