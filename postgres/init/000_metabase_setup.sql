DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'metabase'
  ) THEN
    CREATE ROLE metabase LOGIN PASSWORD 'metabase';
  END IF;
END $$;

SELECT 'CREATE DATABASE metabase WITH OWNER metabase'
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_database
  WHERE datname = 'metabase'
)\gexec

GRANT ALL PRIVILEGES ON DATABASE metabase TO metabase;
