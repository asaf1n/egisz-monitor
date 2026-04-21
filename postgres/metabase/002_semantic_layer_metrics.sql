-- 1. New incident fingerprints for the last 24 hours
SELECT
    ef.error_fingerprint,
    ef.error_category_ru,
    ef.error_subcategory,
    ef.total_occurrences,
    ef.affected_clinics,
    ef.affected_hosts,
    ef.first_seen_at,
    ef.last_seen_at,
    ef.sample_error_text
FROM public.v_error_fingerprints AS ef
WHERE ef.first_seen_at >= NOW() - INTERVAL '24 hours'
ORDER BY ef.total_occurrences DESC, ef.last_seen_at DESC;

-- 2. Hourly SLA by clinic
SELECT
    chs.date_hour,
    chs.clinic_display_name,
    chs.mo_uid,
    chs.total_requests,
    chs.successful_requests,
    chs.failed_requests,
    chs.sla_success_pct
FROM public.v_clinic_hourly_sla AS chs
WHERE chs.date_hour >= NOW() - INTERVAL '72 hours'
ORDER BY chs.date_hour DESC, chs.clinic_display_name ASC;

-- 3. Hourly health by service
SELECT
    sh.date_hour,
    sh.service_display_name,
    sh.total_requests,
    sh.successful_requests,
    sh.failed_requests,
    sh.success_rate_pct
FROM public.v_service_hourly_health AS sh
WHERE sh.date_hour >= NOW() - INTERVAL '72 hours'
ORDER BY sh.date_hour DESC, sh.failed_requests DESC, sh.service_display_name ASC;
