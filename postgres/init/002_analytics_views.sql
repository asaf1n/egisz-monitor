-- Analytics views are recreated by backend/src/services/postgres.service.ts on
-- every startup. This file mirrors the current bootstrap shape of
-- public.v_unified_analytics for first-run initialization.

CREATE OR REPLACE VIEW public.v_unified_analytics AS
SELECT
    ft.transaction_id,
    ft.original_log_id,
    ft.original_log_id AS original_LOGID,
    ft.transaction_date,
    ft.transaction_date::date AS date_day,
    date_trunc('hour', ft.transaction_date) AS date_hour,
    ft.status,
    (ft.status = 'success') AS is_success,
    (ft.status = 'error') AS is_error,
    ft.clinic_id,
    dc.jid,
    dc.jid AS clinic_jid,
    dc.jname,
    dc.is_verified,
    COALESCE(dc.jname, 'JID: ' || ft.clinic_id::text) AS clinic_label,
    COALESCE(dc.jname, 'JID: ' || ft.clinic_id::text) AS clinic_display_name,
    dc.mo_uid,
    dc.mo_domen,
    ft.service_id,
    ds.kind AS service_kind,
    ds.kind AS document_type,
    ds.service_type,
    ds.description AS service_description,
    ds.description AS service_kind_name,
    COALESCE(ds.description, ds.kind) AS document_name,
    COALESCE(ds.description, ds.service_type, ds.kind) AS service_display_name,
    CASE
        WHEN ft.status <> 'error' THEN NULL
        WHEN normalized.clean_error_text ~* 'cvc-|xsd' THEN 'Ошибка валидации XSD'
        WHEN normalized.clean_error_text ~* '(^|[^[:alnum:]_])oid([^[:alnum:]_]|$)|справочник|нси' THEN 'Ошибка заполнения реквизитов/НСИ'
        WHEN normalized.clean_error_text ~* 'timeout|504|connection|refused' THEN 'Ошибка связи'
        WHEN normalized.clean_error_text ~* 'дубликат|зарегистрирован|логическ(ая|ой)?\s+ошибк' THEN 'Ошибка логики ЕГИСЗ'
        ELSE 'Прочие ошибки'
    END AS error_category,
    ft.error_category AS transport_error_category,
    CASE
        WHEN ft.status <> 'error' THEN NULL
        WHEN ee.hostname ~* 'gost-\d+\.infoclinica\.lan' THEN 'clinic_hostname'
        WHEN COALESCE(ee.error_text, ft.error_text) ~* 'auth|authentication|авторизац|логин|парол|token|401|403' THEN 'auth'
        WHEN COALESCE(ee.error_text, ft.error_text) ~* 'timeout|timed out|таймаут' THEN 'timeout'
        WHEN COALESCE(ee.error_text, ft.error_text) ~* 'connection refused|connect failed|could not connect|соединени' THEN 'connection_refused'
        WHEN COALESCE(ee.error_text, ft.error_text) ~* 'proxy' THEN 'proxy'
        WHEN COALESCE(ee.error_text, ft.error_text) ~* 'egisz|егисз' THEN 'egisz'
        WHEN COALESCE(ee.error_text, ft.error_text) ~* 'validation|invalid|некоррект|ошибка форма' THEN 'validation'
        ELSE 'unknown'
    END AS error_subcategory,
    convert_from(convert_to(COALESCE(ee.error_text, ft.error_text), 'UTF8'), 'UTF8') AS error_text,
    normalized.clean_error_text,
    normalized.clean_error_text AS normalized_error_text,
    md5(
      COALESCE(
        CASE
            WHEN ft.status <> 'error' THEN NULL
            WHEN normalized.clean_error_text ~* 'cvc-|xsd' THEN 'Ошибка валидации XSD'
            WHEN normalized.clean_error_text ~* '(^|[^[:alnum:]_])oid([^[:alnum:]_]|$)|справочник|нси' THEN 'Ошибка заполнения реквизитов/НСИ'
            WHEN normalized.clean_error_text ~* 'timeout|504|connection|refused' THEN 'Ошибка связи'
            WHEN normalized.clean_error_text ~* 'дубликат|зарегистрирован|логическ(ая|ой)?\s+ошибк' THEN 'Ошибка логики ЕГИСЗ'
            ELSE 'Прочие ошибки'
        END,
        ''
      ) || '|' || COALESCE(normalized.clean_error_text, '')
    ) AS error_fingerprint,
    ee.hostname,
    (ee.error_id IS NOT NULL) AS has_egisz_error_record,
    COALESCE(dec.base_cost_per_error, 0.00) AS error_base_cost,
    COALESCE(dec.escalation_multiplier, 1.00) AS error_escalation_multiplier,
    CASE
        WHEN ft.status = 'error' THEN COALESCE(dec.base_cost_per_error * dec.escalation_multiplier, 0.00)
        ELSE 0.00
    END AS error_cost
FROM public.fact_transactions AS ft
JOIN public.dim_clinics AS dc
    ON dc.clinic_id = ft.clinic_id
JOIN public.dim_services AS ds
    ON ds.service_id = ft.service_id
LEFT JOIN public.egisz_errors AS ee
    ON ee.original_log_id = ft.original_log_id
LEFT JOIN LATERAL (
    SELECT regexp_replace(
        regexp_replace(
            regexp_replace(
                regexp_replace(
                    regexp_replace(
                        convert_from(convert_to(COALESCE(ee.error_text, ft.error_text), 'UTF8'), 'UTF8'),
                        '\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b',
                        '[IP]',
                        'gi'
                    ),
                    '(?:[[:alnum:]](?:[[:alnum:]-]{0,61}[[:alnum:]])?\.)+[[:alpha:]]{2,}(?::\d+)?',
                    '[HOST]',
                    'gi'
                ),
                '\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b',
                '[ID]',
                'gi'
            ),
            '\b\d{6,}\b',
            '[ID]',
            'g'
        ),
        '\s+',
        ' ',
        'g'
    ) AS clean_error_text
) AS normalized ON TRUE
LEFT JOIN public.dim_error_costs AS dec
    ON dec.error_category = COALESCE(ft.error_category, 'other')
   AND dec.error_subcategory = CASE
        WHEN ft.status <> 'error' THEN NULL
        WHEN COALESCE(ee.error_text, ft.error_text) ~* 'auth|authentication|авторизац|логин|парол|token|401|403' THEN 'auth'
        WHEN COALESCE(ee.error_text, ft.error_text) ~* 'timeout|timed out|таймаут' THEN 'timeout'
        WHEN COALESCE(ee.error_text, ft.error_text) ~* 'connection refused|connect failed|could not connect|соединени' THEN 'connection_refused'
        WHEN COALESCE(ee.error_text, ft.error_text) ~* 'proxy' THEN 'proxy'
        WHEN COALESCE(ee.error_text, ft.error_text) ~* 'egisz|егисз' THEN 'egisz'
        WHEN COALESCE(ee.error_text, ft.error_text) ~* 'validation|invalid|некоррект|ошибка форма' THEN 'validation'
        ELSE 'unknown'
    END
WHERE dc.mo_uid <> 'ghost-log-group-9901';
