"""PostgreSQL warehouse helpers (UPSERT fact, dimensions, ETL state, staging errors)."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Sequence

from egisz_monitor_corp.config_loader import PostgresConfig

try:
    import psycopg2
    from psycopg2 import sql
    from psycopg2.extras import execute_batch, execute_values
except ImportError as e:  # pragma: no cover
    raise ImportError("psycopg2-binary is required for ETL.") from e


def connect_pg(cfg: PostgresConfig):  # type: ignore[no-untyped-def]
    con = psycopg2.connect(
        host=cfg.host,
        port=cfg.port,
        dbname=cfg.database,
        user=cfg.user,
        password=cfg.password,
        options=f"-c search_path={cfg.schema}",
    )
    con.autocommit = False
    return con


def ensure_etl_state_table(con) -> None:  # type: ignore[no-untyped-def]
    with con.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS etl_state (
                pipeline VARCHAR(64) PRIMARY KEY,
                last_log_id BIGINT NOT NULL DEFAULT 0,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            INSERT INTO etl_state (pipeline, last_log_id)
            VALUES ('firebird_exchangelog', 0)
            ON CONFLICT (pipeline) DO NOTHING;
            """
        )
    con.commit()


def get_last_log_id(con, pipeline: str) -> int:  # type: ignore[no-untyped-def]
    with con.cursor() as cur:
        cur.execute("SELECT last_log_id FROM etl_state WHERE pipeline = %s", (pipeline,))
        row = cur.fetchone()
        return int(row[0]) if row else 0


def set_last_log_id(con, pipeline: str, last_log_id: int) -> None:  # type: ignore[no-untyped-def]
    with con.cursor() as cur:
        cur.execute(
            """
            INSERT INTO etl_state (pipeline, last_log_id, updated_at)
            VALUES (%s, %s, NOW())
            ON CONFLICT (pipeline) DO UPDATE
            SET last_log_id = EXCLUDED.last_log_id, updated_at = NOW();
            """,
            (pipeline, last_log_id),
        )
    con.commit()


def upsert_dim_semd(con, kind_code: str, kind_name: str) -> None:  # type: ignore[no-untyped-def]
    with con.cursor() as cur:
        cur.execute(
            """
            INSERT INTO dim_semd_types (kind_code, kind_name)
            VALUES (%s, %s)
            ON CONFLICT (kind_code) DO UPDATE SET kind_name = EXCLUDED.kind_name;
            """,
            (kind_code, kind_name),
        )


def upsert_dim_clinic(con, jid: int, jname: str | None, mo_uid: str | None) -> None:  # type: ignore[no-untyped-def]
    with con.cursor() as cur:
        cur.execute(
            """
            INSERT INTO dim_clinics (jid, jname, mo_uid, updated_at)
            VALUES (%s, %s, %s, NOW())
            ON CONFLICT (jid) DO UPDATE SET
                jname = COALESCE(EXCLUDED.jname, dim_clinics.jname),
                mo_uid = COALESCE(EXCLUDED.mo_uid, dim_clinics.mo_uid),
                updated_at = NOW();
            """,
            (jid, jname, mo_uid or ""),
        )


def upsert_facts_batch(con, rows: Sequence[dict[str, Any]]) -> None:  # type: ignore[no-untyped-def]
    if not rows:
        return
    tpl = (
        "(%(relates_to_id)s, %(jid)s, %(gost_jid_token)s, %(org_oid)s, %(kind_code)s, "
        "%(status)s, %(emdr_id)s, %(errors_json)s::jsonb, %(registration_date)s, %(processed_at)s)"
    )
    values_sql = ", ".join([tpl % _sql_escape_row(r) for r in rows])
    with con.cursor() as cur:
        cur.execute(
            f"""
            INSERT INTO fact_egisz_transactions (
                relates_to_id, jid, gost_jid_token, org_oid, kind_code, status,
                emdr_id, errors_json, registration_date, processed_at
            ) VALUES {values_sql}
            ON CONFLICT (relates_to_id) DO UPDATE SET
                jid = EXCLUDED.jid,
                gost_jid_token = EXCLUDED.gost_jid_token,
                org_oid = EXCLUDED.org_oid,
                kind_code = EXCLUDED.kind_code,
                status = EXCLUDED.status,
                emdr_id = EXCLUDED.emdr_id,
                errors_json = EXCLUDED.errors_json,
                registration_date = EXCLUDED.registration_date,
                processed_at = EXCLUDED.processed_at;
            """
        )


def _sql_escape_row(r: dict[str, Any]) -> dict[str, Any]:
    """Format row for string SQL (internal); prefer parameterized path below."""
    raise NotImplementedError


# Safer: use execute_values
def upsert_facts_batch_safe(con, rows: list[dict[str, Any]]) -> None:  # type: ignore[no-untyped-def]
    if not rows:
        return
    tpl = (
        "%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s"
    )
    args: list[tuple[Any, ...]] = []
    for r in rows:
        args.append(
            (
                r["relates_to_id"],
                r["jid"],
                r["gost_jid_token"],
                r["org_oid"],
                r["kind_code"],
                r["status"],
                r["emdr_id"],
                json.dumps(r["errors_json"]) if not isinstance(r["errors_json"], str) else r["errors_json"],
                r["registration_date"],
                r["processed_at"],
            )
        )
    with con.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO fact_egisz_transactions (
                relates_to_id, jid, gost_jid_token, org_oid, kind_code, status,
                emdr_id, errors_json, registration_date, processed_at
            ) VALUES %s
            ON CONFLICT (relates_to_id) DO UPDATE SET
                jid = EXCLUDED.jid,
                gost_jid_token = EXCLUDED.gost_jid_token,
                org_oid = EXCLUDED.org_oid,
                kind_code = EXCLUDED.kind_code,
                status = EXCLUDED.status,
                emdr_id = EXCLUDED.emdr_id,
                errors_json = EXCLUDED.errors_json,
                registration_date = EXCLUDED.registration_date,
                processed_at = EXCLUDED.processed_at
            """,
            args,
            template=f"({tpl})",
        )


def insert_staging_errors(con, rows: list[tuple[str | None, str, str, str | None]]) -> None:  # type: ignore[no-untyped-def]
    if not rows:
        return
    with con.cursor() as cur:
        execute_batch(
            cur,
            """
            INSERT INTO stg_parse_errors (relates_to_id, error_code, message, log_excerpt)
            VALUES (%s, %s, %s, %s);
            """,
            rows,
        )
