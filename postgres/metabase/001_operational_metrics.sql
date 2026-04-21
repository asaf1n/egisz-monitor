-- 1. SLA clinics by JNAME
SELECT
    ua.jname,
    ua.clinic_id,
    COUNT(*) AS total_requests,
    COUNT(*) FILTER (WHERE ua.status = 'success') AS successful_requests,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE ua.status = 'success') / NULLIF(COUNT(*), 0),
        2
    ) AS sla_success_pct
FROM public.v_unified_analytics AS ua
WHERE ua.transaction_date >= NOW() - INTERVAL '24 hours'
GROUP BY ua.jname, ua.clinic_id
ORDER BY sla_success_pct ASC, total_requests DESC, ua.jname ASC;

-- 2. Error dynamics by GOСТ VPN hosts
SELECT
    date_trunc('hour', ua.transaction_date) AS hour_bucket,
    ua.hostname,
    ua.error_category_ru,
    COUNT(*) AS incidents
FROM public.v_unified_analytics AS ua
WHERE ua.status = 'error'
  AND ua.hostname IS NOT NULL
  AND ua.transaction_date >= NOW() - INTERVAL '7 days'
GROUP BY
    date_trunc('hour', ua.transaction_date),
    ua.hostname,
    ua.error_category_ru
ORDER BY hour_bucket DESC, incidents DESC, ua.hostname ASC;

-- 3. Top-5 clinics with the highest incident growth in the last 24 hours
WITH current_window AS (
    SELECT
        ua.clinic_id,
        ua.jname,
        COUNT(*) AS incidents_last_24h
    FROM public.v_unified_analytics AS ua
    WHERE ua.status = 'error'
      AND ua.transaction_date >= NOW() - INTERVAL '24 hours'
    GROUP BY ua.clinic_id, ua.jname
),
previous_window AS (
    SELECT
        ua.clinic_id,
        COUNT(*) AS incidents_prev_24h
    FROM public.v_unified_analytics AS ua
    WHERE ua.status = 'error'
      AND ua.transaction_date >= NOW() - INTERVAL '48 hours'
      AND ua.transaction_date < NOW() - INTERVAL '24 hours'
    GROUP BY ua.clinic_id
)
SELECT
    cw.jname,
    cw.clinic_id,
    cw.incidents_last_24h,
    COALESCE(pw.incidents_prev_24h, 0) AS incidents_prev_24h,
    cw.incidents_last_24h - COALESCE(pw.incidents_prev_24h, 0) AS incident_growth_abs,
    CASE
        WHEN COALESCE(pw.incidents_prev_24h, 0) = 0 THEN NULL
        ELSE ROUND(
            100.0 * (cw.incidents_last_24h - pw.incidents_prev_24h) / pw.incidents_prev_24h,
            2
        )
    END AS incident_growth_pct
FROM current_window AS cw
LEFT JOIN previous_window AS pw
    ON pw.clinic_id = cw.clinic_id
ORDER BY incident_growth_abs DESC, cw.incidents_last_24h DESC, cw.jname ASC
LIMIT 5;
