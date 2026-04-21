-- Create metabase user and database
CREATE USER metabase WITH PASSWORD 'metabase';
CREATE DATABASE metabaseappdb WITH OWNER metabase;
CREATE DATABASE metabase WITH OWNER metabase;
GRANT ALL PRIVILEGES ON DATABASE metabaseappdb TO metabase;
GRANT ALL PRIVILEGES ON DATABASE metabase TO metabase;
