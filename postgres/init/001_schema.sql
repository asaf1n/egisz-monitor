-- ==========================================
-- 1. Dimensions
-- ==========================================

CREATE TABLE dim_clinics (
    clinic_id SERIAL PRIMARY KEY,
    jid BIGINT NOT NULL,
    mo_uid VARCHAR(256) NOT NULL,
    mo_domen VARCHAR(256),
    CONSTRAINT unq_clinic_mo_uid UNIQUE (mo_uid)
);

COMMENT ON TABLE dim_clinics IS 'Clinic dimension';

CREATE TABLE dim_services (
    service_id SERIAL PRIMARY KEY,
    kind BIGINT NOT NULL,
    service_type BIGINT NOT NULL,
    description VARCHAR(255),
    CONSTRAINT unq_service_kind UNIQUE (kind)
);

COMMENT ON TABLE dim_services IS 'Service dimension';

-- ==========================================
-- 2. Facts
-- ==========================================

CREATE TABLE fact_transactions (
    transaction_id BIGSERIAL PRIMARY KEY,
    clinic_id INT NOT NULL REFERENCES dim_clinics(clinic_id),
    service_id INT NOT NULL REFERENCES dim_services(service_id),
    original_log_id BIGINT UNIQUE,
    transaction_date TIMESTAMP NOT NULL,
    status VARCHAR(20) NOT NULL,
    error_category VARCHAR(50),
    error_text TEXT,
    CONSTRAINT chk_status CHECK (status IN ('success', 'error')),
    CONSTRAINT chk_error_category CHECK (
        (status = 'error' AND error_category IS NOT NULL) OR
        (status = 'success' AND error_category IS NULL)
    )
);

COMMENT ON TABLE fact_transactions IS 'Facts loaded from Firebird exchange logs';

-- ==========================================
-- 3. Indexes
-- ==========================================

CREATE INDEX idx_fact_trans_date ON fact_transactions(transaction_date);
CREATE INDEX idx_fact_trans_agg_dashboard ON fact_transactions(clinic_id, service_id, status);
CREATE INDEX idx_fact_trans_errors ON fact_transactions(status, error_category)
WHERE status = 'error';
CREATE INDEX idx_fact_trans_clinic_id ON fact_transactions(clinic_id);
CREATE INDEX idx_fact_trans_service_id ON fact_transactions(service_id);

-- ==========================================
-- 4. Создание таблицы конфигурации
-- ==========================================

CREATE TABLE IF NOT EXISTS app_config (
    config_id SERIAL PRIMARY KEY,
    config_key VARCHAR(50) UNIQUE NOT NULL,
    config_value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE app_config IS 'Хранение динамических настроек приложения';
COMMENT ON COLUMN app_config.config_key IS 'Уникальный ключ настройки (например, firebird_connection)';
COMMENT ON COLUMN app_config.config_value IS 'Значение настройки в формате JSON';
COMMENT ON COLUMN app_config.updated_at IS 'Время последнего изменения настройки';

-- ==========================================
-- 5. Инициализация базовых настроек
-- ==========================================

-- Добавление настроек по умолчанию для Firebird.
-- ON CONFLICT DO NOTHING гарантирует, что существующие настройки не затрутся при перезапуске БД.
INSERT INTO app_config (config_key, config_value, updated_at)
VALUES (
    'firebird_connection',
    '{
        "host": "host.docker.internal",
        "port": 3050,
        "alias": "proxy_egisz",
        "user": "SYSDBA",
        "password": "masterkey"
    }'::jsonb,
    NOW()
)
ON CONFLICT (config_key) DO NOTHING;
