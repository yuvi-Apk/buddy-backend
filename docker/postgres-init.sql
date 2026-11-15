-- Runs once when the Postgres volume is first created.
-- Separate database for automated tests so they never touch dev data.
CREATE DATABASE buddy_test OWNER buddy;
