-- Metabase persistence initialization.
-- Uses psql meta-commands because CREATE DATABASE cannot run inside DO blocks.

DO
$$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'metabase'
  ) THEN
    CREATE ROLE metabase LOGIN PASSWORD 'metabase';
  END IF;
END
$$;

SELECT 'CREATE DATABASE metabase_db OWNER metabase'
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_database
  WHERE datname = 'metabase_db'
)\gexec

\connect metabase_db

GRANT ALL PRIVILEGES ON SCHEMA public TO metabase;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO metabase;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO metabase;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO metabase;

ALTER DATABASE metabase_db SET idle_in_transaction_session_timeout = 0;
ALTER DATABASE metabase_db SET statement_timeout = 0;
