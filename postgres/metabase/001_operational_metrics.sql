-- Dashboard-aligned operational reports for Metabase.
-- Each query mirrors the logic used by backend/src/controllers/reports.controller.ts.

-- 1. KPI snapshot for the last 24 hours
SELECT
    COUNT(*)::bigint AS 'Общее количество отправлений',
    COALESCE(
        ROUND(
            100.0 * COUNT(*) FILTER (WHERE ua.status = 'success') / NULLIF(COUNT(*), 0),
            2
        ),
        0
    ) AS 'Процент успешности',
    COUNT(DISTINCT NULLIF(TRIM(ua.error_text), ''))::bigint AS 'Уникальные ошибки'
FROM public.v_unified_analytics AS ua
WHERE ua.transaction_date >= NOW() - INTERVAL '24 hours';

-- 2. Error distribution for the last 24 hours
SELECT
    COALESCE(NULLIF(TRIM(ua.error_category_ru), ''), 'Неизвестная') AS 'Категория ошибки',
    COUNT(*)::bigint AS 'Количество инцидентов'
FROM public.v_unified_analytics AS ua
WHERE ua.is_error
  AND ua.transaction_date >= NOW() - INTERVAL '24 hours'
GROUP BY COALESCE(NULLIF(TRIM(ua.error_category_ru), ''), 'Неизвестная')
ORDER BY incidents DESC, category ASC;

-- 3. Hourly trend of successes and errors for the last 24 hours
WITH series AS (
    SELECT generate_series(
        date_trunc('hour', NOW() - INTERVAL '23 hours'),
        date_trunc('hour', NOW()),
        INTERVAL '1 hour'
    ) AS hour_bucket
),
aggregated AS (
    SELECT
        date_trunc('hour', ua.transaction_date) AS hour_bucket,
        COUNT(*) FILTER (WHERE ua.is_success)::bigint AS success_count,
        COUNT(*) FILTER (WHERE ua.is_error)::bigint AS error_count
    FROM public.v_unified_analytics AS ua
    WHERE ua.transaction_date >= NOW() - INTERVAL '24 hours'
    GROUP BY date_trunc('hour', ua.transaction_date)
)
SELECT
    s.hour_bucket AS 'Час',
    COALESCE(a.success_count, 0)::bigint AS 'Количество успешных',
    COALESCE(a.error_count, 0)::bigint AS 'Количество ошибок'
FROM series AS s
LEFT JOIN aggregated AS a
    ON a.hour_bucket = s.hour_bucket
ORDER BY s.hour_bucket ASC;

-- 4. Clinic reliability report for the last 7 days
SELECT
    COALESCE(NULLIF(TRIM(ua.jname), ''), ua.clinic_display_name) AS 'Название клиники',
    ua.mo_uid AS 'UID МО',
    COUNT(*)::bigint AS 'Общее количество',
    COUNT(*) FILTER (WHERE ua.is_error)::bigint AS 'Количество ошибок',
    COALESCE(
        ROUND(
            100.0 * COUNT(*) FILTER (WHERE ua.is_success) / NULLIF(COUNT(*), 0),
            2
        ),
        0
    ) AS 'Процент успешности',
    MAX(ua.transaction_date) FILTER (WHERE ua.is_error) AS 'Последняя ошибка'
FROM public.v_unified_analytics AS ua
WHERE ua.transaction_date >= NOW() - INTERVAL '7 days'
GROUP BY
    COALESCE(NULLIF(TRIM(ua.jname), ''), ua.clinic_display_name),
    ua.mo_uid
HAVING COUNT(*) FILTER (WHERE ua.is_error) > 0
ORDER BY error_count DESC, last_error_at DESC NULLS LAST, clinic_name ASC, ua.mo_uid ASC
LIMIT 20;

-- 5. Service health for the last 7 days
SELECT
    ua.service_display_name AS 'Название сервиса',
    COUNT(*)::bigint AS 'Общее количество',
    COUNT(*) FILTER (WHERE ua.is_success)::bigint AS 'Успешные',
    COUNT(*) FILTER (WHERE ua.is_error)::bigint AS 'Ошибки',
    COALESCE(
        ROUND(
            100.0 * COUNT(*) FILTER (WHERE ua.is_success) / NULLIF(COUNT(*), 0),
            2
        ),
        0
    ) AS 'Процент успешности',
    MAX(ua.transaction_date) AS 'Последний обмен'
FROM public.v_unified_analytics AS ua
WHERE ua.transaction_date >= NOW() - INTERVAL '7 days'
GROUP BY ua.service_display_name
ORDER BY error_count DESC, success_rate ASC, service_name ASC;

-- 6. Status heatmap source for clinic/service activity
WITH latest_activity AS (
    SELECT
        ua.mo_uid,
        ua.service_display_name AS service_name,
        MAX(ua.transaction_date) AS last_activity_at
    FROM public.v_unified_analytics AS ua
    GROUP BY ua.mo_uid, ua.service_display_name
),
clinic_map AS (
    SELECT DISTINCT
        ua.mo_uid,
        ua.clinic_display_name,
        ua.service_display_name AS service_name
    FROM public.v_unified_analytics AS ua
)
SELECT
    cm.clinic_display_name AS 'Название клиники',
    la.mo_uid AS 'UID МО',
    la.service_name AS 'Сервис',
    la.last_activity_at AS 'Последняя активность',
    CASE
        WHEN la.last_activity_at IS NULL THEN 'red'
        WHEN la.last_activity_at >= NOW() - INTERVAL '1 hour' THEN 'green'
        WHEN la.last_activity_at >= NOW() - INTERVAL '24 hours' THEN 'yellow'
        ELSE 'red'
    END AS 'Статус трафика'
FROM latest_activity AS la
JOIN clinic_map AS cm
    ON cm.mo_uid = la.mo_uid
   AND cm.service_name = la.service_name
ORDER BY cm.clinic_display_name ASC, la.service_name ASC;
        MAX(ua.transaction_date) AS last_activity_at
    FROM public.v_unified_analytics AS ua
    GROUP BY ua.mo_uid, ua.service_display_name
),
clinic_map AS (
    SELECT DISTINCT
        ua.mo_uid,
        ua.clinic_display_name,
        ua.service_display_name AS service_name
    FROM public.v_unified_analytics AS ua
)
SELECT
    cm.clinic_display_name,
    la.mo_uid,
    la.service_name,
    la.last_activity_at,
    CASE
        WHEN la.last_activity_at IS NULL THEN 'red'
        WHEN la.last_activity_at >= NOW() - INTERVAL '1 hour' THEN 'green'
        WHEN la.last_activity_at >= NOW() - INTERVAL '24 hours' THEN 'yellow'
        ELSE 'red'
    END AS traffic_status
FROM latest_activity AS la
JOIN clinic_map AS cm
    ON cm.mo_uid = la.mo_uid
   AND cm.service_name = la.service_name
ORDER BY cm.clinic_display_name ASC, la.service_name ASC;
