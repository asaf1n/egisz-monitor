-- Advanced semantic-layer reports for Metabase.
-- These queries build on v_unified_analytics and derived semantic views.

-- 1. New and recurring error fingerprints
SELECT
    ef.error_fingerprint AS 'Отпечаток ошибки',
    ef.error_category_ru AS 'Категория ошибки',
    ef.error_subcategory AS 'Подкатегория ошибки',
    ef.total_occurrences AS 'Общее количество',
    ef.affected_clinics AS 'Затронутые клиники',
    ef.affected_hosts AS 'Затронутые хосты',
    ef.first_seen_at AS 'Впервые замечена',
    ef.last_seen_at AS 'Последний раз замечена',
    ef.sample_error_text AS 'Пример текста ошибки',
    CASE
        WHEN ef.first_seen_at >= NOW() - INTERVAL '24 hours' THEN 'Новая'
        WHEN ef.first_seen_at >= NOW() - INTERVAL '7 days' THEN 'Недавняя'
        ELSE 'Повторяющаяся'
    END AS 'Частота возникновения'
FROM public.v_error_fingerprints AS ef
ORDER BY ef.total_occurrences DESC, ef.last_seen_at DESC;

-- 2. Clinic SLA by hour
SELECT
    chs.date_hour AS 'Дата и час',
    chs.clinic_id AS 'ID клиники',
    chs.clinic_display_name AS 'Название клиники',
    chs.mo_uid AS 'UID МО',
    chs.total_requests AS 'Общее количество запросов',
    chs.successful_requests AS 'Успешные запросы',
    chs.failed_requests AS 'Неудачные запросы',
    chs.sla_success_pct AS 'Процент SLA'
FROM public.v_clinic_hourly_sla AS chs
WHERE chs.date_hour >= NOW() - INTERVAL '72 hours'
ORDER BY chs.date_hour DESC, chs.clinic_display_name ASC;

-- 3. Service health by hour
SELECT
    sh.date_hour AS 'Дата и час',
    sh.service_id AS 'ID сервиса',
    sh.service_display_name AS 'Название сервиса',
    sh.total_requests AS 'Общее количество запросов',
    sh.successful_requests AS 'Успешные запросы',
    sh.failed_requests AS 'Неудачные запросы',
    sh.success_rate_pct AS 'Процент успешности'
FROM public.v_service_hourly_health AS sh
WHERE sh.date_hour >= NOW() - INTERVAL '72 hours'
ORDER BY sh.date_hour DESC, sh.failed_requests DESC, sh.service_display_name ASC;

-- 4. Error channel breakdown by clinic for the last 7 days
SELECT
    ua.clinic_display_name AS 'Название клиники',
    ua.mo_uid AS 'UID МО',
    COALESCE(ua.error_subcategory, 'no_error') AS 'Канал ошибки',
    COUNT(*)::bigint AS 'Количество инцидентов'
FROM public.v_unified_analytics AS ua
WHERE ua.transaction_date >= NOW() - INTERVAL '7 days'
  AND ua.is_error
GROUP BY
    ua.clinic_display_name,
    ua.mo_uid,
    COALESCE(ua.error_subcategory, 'no_error')
ORDER BY incidents DESC, ua.clinic_display_name ASC, error_channel ASC;

-- 5. Unverified and ghost clinics currently participating in exchanges
SELECT
    ua.clinic_id AS 'ID клиники',
    ua.clinic_display_name AS 'Название клиники',
    ua.mo_uid AS 'UID МО',
    ua.mo_domen AS 'Домен МО',
    ua.is_verified AS 'Проверена',
    COUNT(*)::bigint AS 'Общее количество запросов',
    MAX(ua.transaction_date) AS 'Последняя активность',
    COUNT(*) FILTER (WHERE ua.is_error)::bigint AS 'Количество ошибок'
FROM public.v_unified_analytics AS ua
WHERE COALESCE(ua.is_verified, false) = false
GROUP BY
    ua.clinic_id,
    ua.clinic_display_name,
    ua.mo_uid,
    ua.mo_domen,
    ua.is_verified
ORDER BY last_seen_at DESC, error_count DESC, ua.clinic_display_name ASC;

-- 6. Clinics with the strongest incident growth
WITH current_window AS (
    SELECT
        ua.clinic_id,
        ua.clinic_display_name,
        COUNT(*)::bigint AS incidents_last_24h
    FROM public.v_unified_analytics AS ua
    WHERE ua.is_error
      AND ua.transaction_date >= NOW() - INTERVAL '24 hours'
    GROUP BY ua.clinic_id, ua.clinic_display_name
),
previous_window AS (
    SELECT
        ua.clinic_id,
        COUNT(*)::bigint AS incidents_prev_24h
    FROM public.v_unified_analytics AS ua
    WHERE ua.is_error
      AND ua.transaction_date >= NOW() - INTERVAL '48 hours'
      AND ua.transaction_date < NOW() - INTERVAL '24 hours'
    GROUP BY ua.clinic_id
)
SELECT
    cw.clinic_display_name AS 'Название клиники',
    cw.incidents_last_24h AS 'Инциденты за последние 24ч',
    COALESCE(pw.incidents_prev_24h, 0) AS 'Инциденты за предыдущие 24ч',
    cw.incidents_last_24h - COALESCE(pw.incidents_prev_24h, 0) AS 'Абсолютный рост инцидентов',
    CASE
        WHEN COALESCE(pw.incidents_prev_24h, 0) = 0 THEN NULL
        ELSE ROUND(
            100.0 * (cw.incidents_last_24h - pw.incidents_prev_24h) / pw.incidents_prev_24h,
            2
        )
    END AS 'Процент роста инцидентов'
FROM current_window AS cw
LEFT JOIN previous_window AS pw
    ON pw.clinic_id = cw.clinic_id
ORDER BY incident_growth_abs DESC, cw.incidents_last_24h DESC, cw.clinic_display_name ASC
LIMIT 20;

-- 7. Legal entities (JID) and SEMD types summary
SELECT
    ua.jid AS 'JID (ЮЛ)',
    ua.service_kind AS 'Тип СЭМД (KIND)',
    COUNT(*)::bigint AS 'Количество транзакций',
    COUNT(*) FILTER (WHERE ua.is_success)::bigint AS 'Успешные',
    COUNT(*) FILTER (WHERE ua.is_error)::bigint AS 'Ошибки',
    COALESCE(
        ROUND(
            100.0 * COUNT(*) FILTER (WHERE ua.is_success) / NULLIF(COUNT(*), 0),
            2
        ),
        0
    ) AS 'Процент успешности'
FROM public.v_unified_analytics AS ua
WHERE ua.transaction_date >= NOW() - INTERVAL '30 days'
GROUP BY ua.jid, ua.service_kind
ORDER BY ua.jid ASC, 'Количество транзакций' DESC;

-- 8. Error types and counts by all clients
SELECT
    ua.clinic_display_name AS 'Название клиники',
    ua.error_category_ru AS 'Категория ошибки',
    ua.error_subcategory AS 'Подкатегория ошибки',
    COUNT(*)::bigint AS 'Количество ошибок',
    MAX(ua.transaction_date) AS 'Последняя ошибка'
FROM public.v_unified_analytics AS ua
WHERE ua.is_error
  AND ua.transaction_date >= NOW() - INTERVAL '30 days'
GROUP BY ua.clinic_display_name, ua.error_category_ru, ua.error_subcategory
ORDER BY 'Количество ошибок' DESC, ua.clinic_display_name ASC;

-- 9. Top error messages by frequency
SELECT
    ua.error_text AS 'Текст ошибки',
    COUNT(*)::bigint AS 'Частота',
    COUNT(DISTINCT ua.clinic_id)::bigint AS 'Количество клиник',
    MAX(ua.transaction_date) AS 'Последний раз'
FROM public.v_unified_analytics AS ua
WHERE ua.is_error
  AND ua.transaction_date >= NOW() - INTERVAL '30 days'
GROUP BY ua.error_text
ORDER BY 'Частота' DESC
LIMIT 50;

-- 10. Service performance by SEMD type
SELECT
    ua.service_kind AS 'Тип СЭМД',
    ua.service_display_name AS 'Описание сервиса',
    COUNT(*)::bigint AS 'Общее количество',
    COUNT(*) FILTER (WHERE ua.is_success)::bigint AS 'Успешные',
    COUNT(*) FILTER (WHERE ua.is_error)::bigint AS 'Ошибки',
    AVG(EXTRACT(EPOCH FROM (NOW() - ua.transaction_date))/3600)::numeric(10,2) AS 'Средний возраст транзакции (часы)'
FROM public.v_unified_analytics AS ua
WHERE ua.transaction_date >= NOW() - INTERVAL '7 days'
GROUP BY ua.service_kind, ua.service_display_name
ORDER BY 'Общее количество' DESC;
