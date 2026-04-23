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

SELECT 'CREATE DATABASE metabase_db WITH OWNER metabase'
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_database
  WHERE datname = 'metabase_db'
)\gexec

GRANT ALL PRIVILEGES ON DATABASE metabase_db TO metabase;
