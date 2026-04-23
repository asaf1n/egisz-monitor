# EGISZ Monitor Agents Manifest

**Stack Version:** v1.5

## РћРїРёСЃР°РЅРёРµ СЂРѕР»РµР№

* **Р”РѕРєРµСЂ:** РћСЂРєРµСЃС‚СЂР°С†РёСЏ, Р±РµР·РѕРїР°СЃРЅРѕСЃС‚СЊ (non-root), РЅР°СЃС‚СЂРѕР№РєР° РїРѕСЂС‚РѕРІ, Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРёР№ provisioning Metabase.
* **Codex/Cursor:** ETL-Р»РѕРіРёРєР°, SQL-РІРёС‚СЂРёРЅС‹ (Semantic Layer), РёРЅС‚РµСЂР°РєС‚РёРІРЅРѕСЃС‚СЊ РёРЅС‚РµСЂС„РµР№СЃР°.
* **Gemini:** РРЅС‚РµР»Р»РµРєС‚СѓР°Р»СЊРЅР°СЏ РёРЅС‚РµСЂРїСЂРµС‚Р°С†РёСЏ РєРѕРґРѕРІ РѕС€РёР±РѕРє, СЂР°СЃС‡РµС‚ В«РѕС‚РїРµС‡Р°С‚РєРѕРІВ», С„РѕСЂРјРёСЂРѕРІР°РЅРёРµ С‚РµРєСЃС‚РѕРІС‹С… СЂРµР·СЋРјРµ РїРѕ РёРЅС†РёРґРµРЅС‚Р°Рј, РІР°Р»РёРґР°С†РёСЏ СЃС…РµРј РґР°РЅРЅС‹С… РЅР° РѕСЃРЅРѕРІРµ СЌС‚Р°Р»РѕРЅРЅРѕР№ СЃРїРµС†РёС„РёРєР°С†РёРё `proxy.pdf`.

## Progress Update

| РљРѕРјРїРѕРЅРµРЅС‚ | РР·РјРµРЅРµРЅРёРµ | РЎС‚Р°С‚СѓСЃ |
| --- | --- | --- |
| Backend | РСЃРїСЂР°РІР»РµРЅ JOIN `EGISZ_LICENSES` (`LID -> ID`). | вњ… РЎС‚Р°Р±РёР»СЊРЅРѕ |
| Backend | РСЃРїСЂР°РІР»РµРЅ ETL-РјР°РїРїРёРЅРі: `clinic_id <- JID`, `document_type <- KIND`, fallback `document_name` РїРѕ `KIND`. | вњ… РЎС‚Р°Р±РёР»СЊРЅРѕ |
| SQL Views | Р’ `v_unified_analytics` РґРѕР±Р°РІР»РµРЅС‹ `document_type/document_name`; РґРѕР±Р°РІР»РµРЅ `v_clinic_performance` Р±РµР· СЃРјРµС€РµРЅРёСЏ `JID` Рё С‚РёРїРѕРІ РґРѕРєСѓРјРµРЅС‚РѕРІ. | вњ… РЎС‚Р°Р±РёР»СЊРЅРѕ |
| ETL Runtime | РЈСЃС‚СЂР°РЅРµРЅРѕ "Р·Р°РІРёСЃР°РЅРёРµ РЅР° 0": heartbeat РЅР° СЌС‚Р°РїРµ `extracting`, С‚Р°Р№РјР°СѓС‚С‹ Firebird ETL/COUNT, fallback Р±РµР· total count. | вњ… РЎС‚Р°Р±РёР»СЊРЅРѕ |
| Frontend | Р”Р»СЏ polling `/api/reports/etl-status` РѕС‚РєР»СЋС‡РµРЅРѕ РєСЌС€РёСЂРѕРІР°РЅРёРµ (`no-store`), РёСЃРєР»СЋС‡РµРЅС‹ Р»РѕР¶РЅС‹Рµ `304` РїСЂРё РѕРїСЂРѕСЃРµ СЃС‚Р°С‚СѓСЃР°. | вњ… РЎС‚Р°Р±РёР»СЊРЅРѕ |
| Frontend | РЈРґР°Р»РµРЅС‹ РґСѓР±Р»РёСЂСѓСЋС‰РёРµ Р±Р»РѕРєРё, РІРЅРµРґСЂРµРЅ Flat Design. | рџ›  РћРїС‚РёРјРёР·Р°С†РёСЏ |
| Data Flow | РЎС‚СЂРѕРіРёР№ РёСЃС‚РѕС‡РЅРёРє РєР»РёРЅРёРєРё вЂ” РїРѕР»Рµ `JID` СЃС‚СЂРѕРєРё Firebird (Р±РµР· fallback-СЌРєСЃС‚СЂР°РєС†РёРё РёР· С‚РµРєСЃС‚Р°). | вњ… РџСЂРѕРІРµСЂРµРЅРѕ |
| SQL Views | `v_unified_analytics` СЂР°СЃС€РёСЂРµРЅ: `clean_error_text` (РјР°СЃРєРёСЂРѕРІР°РЅРёРµ host/IP/РґРёРЅР°РјРёС‡РµСЃРєРёС… ID), РѕР±РЅРѕРІР»РµРЅС‹ regex-РєР°С‚РµРіРѕСЂРёРё РѕС€РёР±РѕРє РїРѕРґ Р±РёР·РЅРµСЃ- Рё С‚РµС…РјРѕРЅРёС‚РѕСЂРёРЅРі. | вњ… РЎС‚Р°Р±РёР»СЊРЅРѕ |
| Metabase | РџРµСЂРµСЃРѕР±СЂР°РЅ provisioning: РєРѕР»Р»РµРєС†РёРё `РЎС‚Р°С‚РёСЃС‚РёРєР° РѕС‚РїСЂР°РІРєРё` Рё `РўРµС…РЅРёС‡РµСЃРєРёРµ РјРµС‚СЂРёРєРё`, РґРµС„РѕР»С‚РЅС‹Рµ РґР°С€Р±РѕСЂРґС‹ `Р‘РёР·РЅРµСЃ-РјРѕРЅРёС‚РѕСЂРёРЅРі` Рё `РўРµС…РЅРёС‡РµСЃРєРёР№ Р°РЅР°Р»РёР·`. | вњ… РЎС‚Р°Р±РёР»СЊРЅРѕ |

## РћР±РЅРѕРІР»РµРЅРЅС‹Р№ РњР°РЅРёС„РµСЃС‚ AGENTS.md (v1.4)

| Р¤СѓРЅРєС†РёСЏ | Р РµР°Р»РёР·Р°С†РёСЏ | РСЃС‚РѕС‡РЅРёРє РґР°РЅРЅС‹С… |
| --- | --- | --- |
| Progress | РџРѕСЃС‚СЂРѕС‡РЅС‹Р№ (РґРёРЅР°РјРёС‡РµСЃРєРёР№) | `COUNT(*)` РёР· Firebird |
| РЎР­РњР” | РњР°РїРїРёРЅРі (РќРЎР 1.2.643.5.1.13.13.11.1520) | `nsi.rosminzdrav.ru` |
| UI | Flat Admin Hub (v1.3) | Р­СЃРєРёР· РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ |
| Metabase | PostgreSQL Persistence | `metabase_db` |
| Monitoring | Р Р°Р·РґРµР»РµРЅРёРµ РЅР° РєРѕРЅС‚СѓСЂС‹: Р±РёР·РЅРµСЃ/РїСЂРѕРґСѓРєС‚ Рё С‚РµС…РЅРёС‡РµСЃРєРёР№ Р°РЅР°Р»РёР· | `v_unified_analytics`, `metabase-init/setup-dashboards.sh` |

## Р”РѕРїРѕР»РЅРµРЅРёСЏ v1.4

- Data Layer: Р’РЅРµРґСЂРµРЅ СЂР°СЃС€РёСЂРµРЅРЅС‹Р№ СЃРїСЂР°РІРѕС‡РЅРёРє РЎР­РњР” (224 Р·Р°РїРёСЃРё) СЃ Р»РѕРіРёРєРѕР№ fallback РЅР° KIND Р»РёС†РµРЅР·РёРё РїСЂРё РѕС‚СЃСѓС‚СЃС‚РІРёРё СЃРѕРѕС‚РІРµС‚СЃС‚РІРёСЏ.
- Performance: Р РµР°Р»РёР·РѕРІР°РЅ РґРёРЅР°РјРёС‡РµСЃРєРёР№ СЂР°СЃС‡РµС‚ РїСЂРѕРіСЂРµСЃСЃР° СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёРё (current/total) РЅР° РѕСЃРЅРѕРІРµ СЂРµР°Р»СЊРЅРѕРіРѕ РєРѕР»РёС‡РµСЃС‚РІР° Р·Р°РїРёСЃРµР№ РІ Firebird.
- Architecture: РћРїС‚РёРјРёР·РёСЂРѕРІР°РЅР° РёРЅРёС†РёР°Р»РёР·Р°С†РёСЏ СЃС…РµРјС‹: ensureSchema() РёСЃРєР»СЋС‡РµРЅ РёР· С†РёРєР»Р° РѕРїСЂРѕСЃР° СЃС‚Р°С‚СѓСЃР°, РїСЂРµРґРѕС‚РІСЂР°С‰Р°СЏ Р»РёС€РЅРёРµ DROP VIEW.
- UI: Layout v1.3: РєРЅРѕРїРєРё СѓРїСЂР°РІР»РµРЅРёСЏ РІС‹СЂРѕРІРЅРµРЅС‹ РІ СЂСЏРґ РјРµР¶РґСѓ РїСЂРѕРіСЂРµСЃСЃ-Р±Р°СЂРѕРј Рё Р»РѕРіРѕРј, РІРЅРµРґСЂРµРЅ РЅРµР№С‚СЂР°Р»СЊРЅС‹Р№ Flat-РґРёР·Р°Р№РЅ.
- Analytics: `clean_error_text` РЅРѕСЂРјР°Р»РёР·СѓРµС‚ `MSGTEXT` (hostname/IP/ID masking), `error_category` РїСЂРёРІРµРґРµРЅ Рє Р±РёР·РЅРµСЃ-РїСЂР°РІРёР»Р°Рј (XSD, РќРЎР, СЃРІСЏР·СЊ, Р»РѕРіРёРєР° Р•Р“РРЎР—).
- BI Provisioning: `setup-dashboards.sh` СЃРѕР·РґР°РµС‚ РєРѕР»Р»РµРєС†РёРё Рё РґРµС„РѕР»С‚РЅС‹Рµ РґР°С€Р±РѕСЂРґС‹ РЅРѕРІРѕРіРѕ С„РѕСЂРјР°С‚Р° Р±РµР· legacy KPI/SLA Р»РµР№Р±Р»РѕРІ.

## ETL Performance (v1.3.3)

- Р’РЅРµРґСЂРµРЅР° РїРѕСЃС‚СЂР°РЅРёС‡РЅР°СЏ СЌРєСЃС‚СЂР°РєС†РёСЏ (Pagination) РёР· Firebird (FIRST/SKIP).
- РћРїС‚РёРјРёР·РёСЂРѕРІР°РЅС‹ РёРЅРґРµРєСЃС‹ РґР»СЏ СЃРІСЏР·Рё EXCHANGELOG Рё EGISZ_LICENSES РїРѕ MSGID/DOCUMENTID.
- РЈСЃС‚СЂР°РЅРµРЅР° РїСЂРѕР±Р»РµРјР° "Р·Р°РјРµСЂР·Р°РЅРёСЏ" UI Р·Р° СЃС‡РµС‚ РѕС‚РєР»СЋС‡РµРЅРёСЏ РєСЌС€РёСЂРѕРІР°РЅРёСЏ polling-Р·Р°РїСЂРѕСЃРѕРІ.

## Infrastructure (v1.3.4)

- РЈРІРµР»РёС‡РµРЅ Р»РёРјРёС‚ Java Heap РґР»СЏ Metabase (-Xmx2g) РґР»СЏ СЃС‚Р°Р±РёР»СЊРЅРѕРіРѕ Р°РЅР°Р»РёР·Р° 200k+ Р·Р°РїРёСЃРµР№.
- РџСЂРѕРІРµСЂРµРЅР° РєРѕРЅС„РёРіСѓСЂР°С†РёСЏ С‚РѕРјРѕРІ PostgreSQL; РґРёСЃРєРѕРІРѕРµ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІРѕ СѓРїСЂР°РІР»СЏРµС‚СЃСЏ С‡РµСЂРµР· Docker Resources.

## РџСЂР°РІРёР»Рѕ СЃРѕРїСЂРѕРІРѕР¶РґРµРЅРёСЏ РёР·РјРµРЅРµРЅРёР№

- РџРѕСЃР»Рµ РєР°Р¶РґРѕР№ Р·РЅР°С‡РёРјРѕР№ РїСЂР°РІРєРё С„РёРєСЃРёСЂРѕРІР°С‚СЊ РёР·РјРµРЅРµРЅРёСЏ РІ `AGENTS.md` (РѕР±РЅРѕРІР»СЏС‚СЊ Progress Update Рё/РёР»Рё СЃРѕРѕС‚РІРµС‚СЃС‚РІСѓСЋС‰РёР№ СЂР°Р·РґРµР» РјР°РЅРёС„РµСЃС‚Р°).

## v1.4.1 (2026-04-23)

- Infra: replaced remaining legacy volume references from `pgdata` to `postgres_data` in production compose and operational setup docs/scripts.
- Firebird ETL: hardened pagination query builder to enforce deterministic `ORDER BY LOGDATE, LOGID` when source query has no `ORDER BY`.
- ETL observability: added explicit start/finish logs around Firebird page fetch with page number, offset, row count, and fetch duration.

## v1.4.2 (2026-04-23)

- ETL extraction page size is now configurable via `FIREBIRD_ETL_PAGE_SIZE` with default `1000` (instead of hardcoded 5000).
- ETL Firebird query timeout is now finite by default (`FIREBIRD_ETL_QUERY_TIMEOUT_MS=120000`) to avoid indefinite fetch hangs.
- Added extraction heartbeat status updates while waiting for each Firebird page fetch, so `/api/reports/etl-status` keeps changing during long reads.

## v1.4.3 (2026-04-23)

- Reduced Firebird ETL timeout default to 30s (`FIREBIRD_ETL_QUERY_TIMEOUT_MS=30000`) across backend defaults and compose/env templates.
- Reduced default Firebird ETL page size to 200 (`FIREBIRD_ETL_PAGE_SIZE=200`) to lower per-page extraction pressure.
- Optimized pagination ordering toward `LOGID` and added runtime order normalization for legacy persisted `ORDER BY e.LOGDATE, e.LOGID` queries.

## v1.4.4 (2026-04-23)

- Firebird ETL: replaced derived-table pagination (`SELECT FIRST/SKIP ... FROM (<full query>)`) with root-select pagination injection (`SELECT FIRST ... SKIP ...`) to improve first-page response time and reduce full-query materialization risk.
- Firebird ETL: kept safe fallback to derived-table pagination for uncommon non-`SELECT` custom queries (for example CTE-first statements).

## v1.4.5 (2026-04-23)

- Firebird ETL query was redesigned to prioritize fast source fetch: removed expensive request/response self-joins from the default extraction SQL and switched to `EXCHANGELOG -> latest EGISZ_MESSAGES -> EGISZ_LICENSES` shape with `ORDER BY e.LOGID DESC`.
- Firebird type-safety hardening: license join now safely maps string `DOCUMENTID` to numeric `EGISZ_LICENSES.ID` via guarded `CASE ... CAST(... AS BIGINT)` to avoid conversion failures on UUID-like payloads.
- Pagination builder fix: root-level `FIRST/SKIP` injection no longer strips inner `FIRST` clauses in subqueries, preserving deterministic and valid execution plans.
- ETL operating rule aligned: extraction stays focused on fast Firebird retrieval first; parsing/normalization happens after data is fetched.

## v1.4.6 (2026-04-23)

- Documentation: added Firebird ETL optimization playbook to README with index/keys checklist, index activation/create SQL, statistics refresh commands, and EXPLAIN/PLAN verification workflow for stable subsequent sync runs.


## v1.5 (2026-04-23)

- Architecture: Parsing Logic moved from Source SQL to ETL Service. Firebird query is now a flat selection of raw logs (EXCHANGELOG + EGISZ_MESSAGES) with backend-side status/error extraction.
- Data semantics: DocumentID stored as metadata only, excluded from Join logic to avoid heavy source-side joins.
- ETL parser: XML-first parsing now uses <ns2:status> as primary status signal (success|error), extracts <ns2:code> and <ns2:message>, and keeps raw-network detection for Socket error, Host not found, CA_INACCESSIBILITY plus LOGSTATE = 3.
- Warehouse: fact table persists parsed fields into error_code and error_message (alongside existing error_category/error_text) for downstream analytics compatibility.
- Performance criterion: first page target remains < 1s for FIRST 200 on healthy Firebird index path; requires runtime measurement in target environment.


## v1.5.1 (2026-04-23)

- Documentation: README.md fully rewritten as an internal corporate knowledge base with current stack, environment access matrix, operational startup/check/runbook commands, and API map.
- ETL docs: README now documents the flat Firebird extraction strategy and backend-side parsing rules (LOGSTATE/LOGTEXT, XML <ns2:status>/<ns2:code>/<ns2:message>, raw network patterns).
- Data docs: README now explicitly describes storage of parsed fields in fact_transactions (error_category, error_code, error_message, error_text) and explains runtime schema behavior.


## v1.5.2 (2026-04-23)

- Firebird schema alignment: source query updated to use only existing fields from EXCHANGELOG and EGISZ_MESSAGES (LOGID, LOGDATE, LOGSTATE, LOGTEXT, MSGTEXT, METHOD, URI, ACTION, PARENTLOGID, GRPID, CREATEDATE, MODIFYDATE, REPLYTO, DOCUMENTID).
- Removed invalid source-field assumptions: dropped non-existent EXCHANGELOG.JID, EXCHANGELOG.KIND, and EGISZ_MESSAGES.MSGTEXT from default extraction SQL.
- Documentation hardening: README supplemented with explicit table/field mapping for EXCHANGELOG, EGISZ_MESSAGES, EGISZ_LICENSES, JPERSONS, including note that DOCUMENTID is metadata-only and excluded from heavy join logic.


## v1.5.3 (2026-04-23)

- Runtime config audit: checked repository env/compose files and PostgreSQL pp_config for legacy Firebird join SQL with non-existent fields; no persisted joinQuery found.
- Guardrail added: 
ormalizeJoinQuery() now auto-falls back to default query when legacy non-existent columns are detected (e.JID, e.KIND, m.MSGTEXT).
- Validation: backend TypeScript build passed after guardrail update.


## v1.5.4 (2026-04-23)

- PostgreSQL init alignment: postgres/init/001_schema.sql synchronized with runtime schema contract for dim_error_costs (is_active column, error_category unique key, runtime-compatible seed values and conflict target).
- Bootstrap consistency: egisz_errors.clinic_id in init schema relaxed to nullable to match runtime ETL lifecycle (insert/backfill/clinic binding).
- Init scripts audit completed:  00_metabase_setup.sql and  2-metabase.sql are both idempotent; kept as-is because  2-metabase.sql also sets default privileges and DB timeouts for Metabase persistence.


## v1.5.5 (2026-04-23)

- Clinic binding policy updated: clinic_id is treated as mandatory; unmatched rows are isolated into explicit unresolved-jid-* clinic buckets instead of being mixed with verified clinics.
- ETL normalization: when JID cannot be resolved from source/fallback, records now get deterministic unresolved clinic identifiers and labels (Не сопоставлено (нет JID) [...]) with is_verified=false.
- Bootstrap schema re-aligned: postgres/init/001_schema.sql keeps egisz_errors.clinic_id as NOT NULL to match required binding policy.


## v1.5.6 (2026-04-23)

- Historical data safety: backfill now assigns any remaining egisz_errors rows with NULL clinic_id to dedicated unresolved-jid-bucket clinic before NOT NULL enforcement.
- Constraint hardening: this ensures schema migration can keep egisz_errors.clinic_id mandatory without dropping unresolved rows.

