-- ==========================================
-- Runtime-owned schema baseline
-- ==========================================
--
-- The backend service is the source of truth for schema evolution and for all
-- analytics views. This bootstrap file is only applied on the very first
-- PostgreSQL initialization when pgdata is empty.

CREATE TABLE dim_clinics (
    clinic_id SERIAL PRIMARY KEY,
    jid BIGINT NOT NULL,
    mo_uid VARCHAR(256) NOT NULL,
    mo_domen VARCHAR(256),
    jname VARCHAR(255),
    is_verified BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT unq_clinic_mo_uid UNIQUE (mo_uid)
);

COMMENT ON TABLE dim_clinics IS 'Clinic dimension';

CREATE TABLE dim_services (
    service_id SERIAL PRIMARY KEY,
    kind VARCHAR(255) NOT NULL,
    service_type VARCHAR(64) NOT NULL,
    description VARCHAR(255),
    CONSTRAINT unq_service_kind UNIQUE (kind)
);

COMMENT ON TABLE dim_services IS 'Service dimension';

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

CREATE TABLE egisz_errors (
    error_id BIGSERIAL PRIMARY KEY,
    original_log_id BIGINT NOT NULL UNIQUE,
    clinic_id INT NOT NULL REFERENCES dim_clinics(clinic_id),
    transaction_date TIMESTAMP NOT NULL,
    error_category VARCHAR(50) NOT NULL,
    error_text TEXT NOT NULL,
    hostname VARCHAR(256)
);

COMMENT ON TABLE egisz_errors IS 'Normalized EGISZ error log linked to dim_clinics';

CREATE INDEX idx_dim_clinics_mo_domen ON dim_clinics(mo_domen);
CREATE UNIQUE INDEX idx_dim_clinics_mo_domen_unique ON dim_clinics(mo_domen) WHERE mo_domen IS NOT NULL;
CREATE INDEX idx_dim_clinics_jid ON dim_clinics(jid);
CREATE INDEX idx_fact_trans_date ON fact_transactions(transaction_date);
CREATE INDEX idx_fact_trans_agg_dashboard ON fact_transactions(clinic_id, service_id, status);
CREATE INDEX idx_fact_trans_errors ON fact_transactions(status, error_category)
WHERE status = 'error';
CREATE INDEX idx_fact_trans_clinic_id ON fact_transactions(clinic_id);
CREATE INDEX idx_fact_trans_service_id ON fact_transactions(service_id);
CREATE INDEX idx_fact_trans_original_log_id ON fact_transactions(original_log_id);
CREATE INDEX idx_egisz_errors_clinic_id ON egisz_errors(clinic_id);
CREATE INDEX idx_egisz_errors_hostname ON egisz_errors(hostname);
CREATE INDEX idx_egisz_errors_transaction_date ON egisz_errors(transaction_date);
CREATE INDEX idx_egisz_errors_original_log_id ON egisz_errors(original_log_id);

CREATE TABLE IF NOT EXISTS app_config (
    config_id SERIAL PRIMARY KEY,
    config_key VARCHAR(50) UNIQUE NOT NULL,
    config_value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE app_config IS 'Application runtime configuration';
COMMENT ON COLUMN app_config.config_key IS 'Unique configuration key';
COMMENT ON COLUMN app_config.config_value IS 'Configuration value in JSON format';
COMMENT ON COLUMN app_config.updated_at IS 'Configuration update timestamp';

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
