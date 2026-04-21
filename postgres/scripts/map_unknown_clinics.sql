-- Mass mapping for temporary ghost clinics.
-- Run after reviewing hostname -> JID matches.
--
-- Assumptions:
-- 1. search_path points to the application schema.
-- 2. The target clinic already exists in dim_clinics as a verified row.

BEGIN;

WITH mapping(hostname, target_jid, target_jname) AS (
  VALUES
    -- ('gost-12345.infoclinica.lan', 12345, 'Клиника 12345')
    -- ('gost-demo.infoclinica.lan', 67890, 'Демо клиника')
),
target_clinics AS (
  SELECT
    m.hostname,
    dc.clinic_id AS target_clinic_id,
    dc.jid,
    dc.jname,
    dc.mo_uid,
    dc.mo_domen
  FROM mapping m
  JOIN dim_clinics dc
    ON dc.jid = m.target_jid
   AND dc.is_verified = TRUE
),
ghost_clinics AS (
  SELECT
    dc.clinic_id AS ghost_clinic_id,
    dc.mo_domen AS hostname
  FROM dim_clinics dc
  JOIN mapping m
    ON dc.mo_domen = m.hostname
  WHERE dc.is_verified = FALSE
)
UPDATE fact_transactions ft
SET clinic_id = tc.target_clinic_id
FROM ghost_clinics gc
JOIN target_clinics tc
  ON tc.hostname = gc.hostname
WHERE ft.clinic_id = gc.ghost_clinic_id;

WITH mapping(hostname, target_jid, target_jname) AS (
  VALUES
    -- ('gost-12345.infoclinica.lan', 12345, 'Клиника 12345')
    -- ('gost-demo.infoclinica.lan', 67890, 'Демо клиника')
),
target_clinics AS (
  SELECT
    m.hostname,
    dc.clinic_id AS target_clinic_id
  FROM mapping m
  JOIN dim_clinics dc
    ON dc.jid = m.target_jid
   AND dc.is_verified = TRUE
),
ghost_clinics AS (
  SELECT
    dc.clinic_id AS ghost_clinic_id,
    dc.mo_domen AS hostname
  FROM dim_clinics dc
  JOIN mapping m
    ON dc.mo_domen = m.hostname
  WHERE dc.is_verified = FALSE
)
UPDATE egisz_errors ee
SET clinic_id = tc.target_clinic_id
FROM ghost_clinics gc
JOIN target_clinics tc
  ON tc.hostname = gc.hostname
WHERE ee.clinic_id = gc.ghost_clinic_id;

WITH mapping(hostname, target_jid, target_jname) AS (
  VALUES
    -- ('gost-12345.infoclinica.lan', 12345, 'Клиника 12345')
    -- ('gost-demo.infoclinica.lan', 67890, 'Демо клиника')
)
UPDATE dim_clinics dc
SET
  jid = m.target_jid,
  jname = m.target_jname,
  is_verified = TRUE
FROM mapping m
WHERE dc.mo_domen = m.hostname;

DELETE FROM dim_clinics dc
WHERE dc.is_verified = FALSE
  AND EXISTS (
    SELECT 1
    FROM dim_clinics verified
    WHERE verified.mo_domen = dc.mo_domen
      AND verified.is_verified = TRUE
      AND verified.clinic_id <> dc.clinic_id
  );

COMMIT;
