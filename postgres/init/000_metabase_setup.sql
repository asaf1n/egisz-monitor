-- Create metabase user and database
CREATE USER metabase WITH PASSWORD 'metabase';
CREATE DATABASE metabase WITH OWNER metabase;
GRANT ALL PRIVILEGES ON DATABASE metabase TO metabase;
