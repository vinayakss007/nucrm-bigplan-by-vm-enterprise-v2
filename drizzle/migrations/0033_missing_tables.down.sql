-- Down Migration: 0033_missing_tables
DROP TABLE IF EXISTS canned_responses;
DROP TABLE IF EXISTS csat_surveys;
DROP TABLE IF EXISTS dunning_attempts;
DROP TABLE IF EXISTS dunning_settings;
