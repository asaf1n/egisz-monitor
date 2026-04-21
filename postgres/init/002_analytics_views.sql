-- ==========================================
-- 1. Analytics views for dashboards / Metabase
-- ==========================================

CREATE OR REPLACE VIEW view_daily_summary AS
SELECT
    ft.transaction_date::date AS summary_date,
    dc.mo_uid AS organization_oid,
    COALESCE(ds.description, ds.kind::text) AS semd_type,
    COUNT(*) FILTER (WHERE ft.status = 'success') AS success_count,
    COUNT(*) FILTER (WHERE ft.status = 'error') AS error_count
FROM fact_transactions AS ft
JOIN dim_clinics AS dc
    ON dc.clinic_id = ft.clinic_id
JOIN dim_services AS ds
    ON ds.service_id = ft.service_id
GROUP BY
    ft.transaction_date::date,
    dc.mo_uid,
    COALESCE(ds.description, ds.kind::text);

COMMENT ON VIEW view_daily_summary IS
'Daily summary by date, organization OID and SEMD type for BI dashboards';

COMMENT ON COLUMN view_daily_summary.summary_date IS
'Transaction date aggregated to day';
COMMENT ON COLUMN view_daily_summary.organization_oid IS
'Organization OID from dim_clinics.mo_uid';
COMMENT ON COLUMN view_daily_summary.semd_type IS
'SEMD type from service description, fallback to service kind';
COMMENT ON COLUMN view_daily_summary.success_count IS
'Number of successful transactions';
COMMENT ON COLUMN view_daily_summary.error_count IS
'Number of failed transactions';


CREATE OR REPLACE VIEW view_error_analysis AS
SELECT
    ft.error_text,
    ft.error_category AS category,
    COUNT(*) AS occurrence_count,
    MIN(ft.transaction_date) AS first_seen_at,
    MAX(ft.transaction_date) AS last_seen_at
FROM fact_transactions AS ft
WHERE ft.status = 'error'
  AND ft.transaction_date >= CURRENT_TIMESTAMP - INTERVAL '7 days'
GROUP BY
    ft.error_text,
    ft.error_category;

COMMENT ON VIEW view_error_analysis IS
'Error breakdown for the last 7 days';

COMMENT ON COLUMN view_error_analysis.error_text IS
'Original error text';
COMMENT ON COLUMN view_error_analysis.category IS
'Normalized error category';
COMMENT ON COLUMN view_error_analysis.occurrence_count IS
'Error frequency during the last 7 days';
COMMENT ON COLUMN view_error_analysis.first_seen_at IS
'First occurrence timestamp during the last 7 days';
COMMENT ON COLUMN view_error_analysis.last_seen_at IS
'Most recent occurrence timestamp during the last 7 days';


CREATE OR REPLACE VIEW view_clinic_sla AS
WITH clinic_last_response AS (
    SELECT
        ft.clinic_id,
        MAX(ft.transaction_date) AS last_response_at
    FROM fact_transactions AS ft
    GROUP BY ft.clinic_id
)
SELECT
    dc.clinic_id,
    dc.jid,
    dc.mo_uid AS organization_oid,
    dc.mo_domen,
    clr.last_response_at,
    CURRENT_TIMESTAMP - clr.last_response_at AS time_since_last_response,
    EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - clr.last_response_at))::bigint
        AS seconds_since_last_response,
    ROUND(
        EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - clr.last_response_at)) / 60.0,
        2
    ) AS minutes_since_last_response
FROM dim_clinics AS dc
LEFT JOIN clinic_last_response AS clr
    ON clr.clinic_id = dc.clinic_id;

COMMENT ON VIEW view_clinic_sla IS
'Time since last response per clinic relative to current timestamp';

COMMENT ON COLUMN view_clinic_sla.clinic_id IS
'Clinic surrogate key';
COMMENT ON COLUMN view_clinic_sla.jid IS
'Clinic JID';
COMMENT ON COLUMN view_clinic_sla.organization_oid IS
'Organization OID from dim_clinics.mo_uid';
COMMENT ON COLUMN view_clinic_sla.mo_domen IS
'Clinic domain';
COMMENT ON COLUMN view_clinic_sla.last_response_at IS
'Timestamp of the latest transaction for the clinic';
COMMENT ON COLUMN view_clinic_sla.time_since_last_response IS
'Interval between current timestamp and latest clinic transaction';
COMMENT ON COLUMN view_clinic_sla.seconds_since_last_response IS
'Elapsed time since latest clinic transaction in seconds';
COMMENT ON COLUMN view_clinic_sla.minutes_since_last_response IS
'Elapsed time since latest clinic transaction in minutes';
