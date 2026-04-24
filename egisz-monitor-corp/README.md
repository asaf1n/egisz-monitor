# egisz-monitor-corp

Корпоративное ядро ETL для мониторинга интеграции МИС с ЕГИСЗ (РЭМД): разбор `EXCHANGELOG.LOGTEXT` (SOAP + транспорт), нормализация и загрузка в PostgreSQL для Metabase.

## Отличия от `egisz-monitor`

- Только Python (без React и без TypeScript ETL).
- Ключ витрины: `relates_to_id` ← `relatesToMessage` (асинхронная связка), UPSERT в `fact_egisz_transactions`, без watermark по `MODIFYDATE`.
- Справочник СЭМД перенесён из `backend/src/utils/semdDictionary.ts` в `egisz_monitor_corp/semd_dictionary.py`.

## Установка

```bash
cd egisz-monitor-corp
pip install -e ".[dev]"
pytest
```

## Схема БД

Файл `sql/001_schema.sql`: `fact_egisz_transactions`, `dim_semd_types`, `dim_clinics`, `stg_parse_errors`, представление `v_egisz_transactions_enriched`.

## API парсера

Класс `EgiszMonitorParser` (`egisz_monitor_corp/parser.py`):

- `parse_xml(xml_string)` — ленивый разбор (нет SOAP-формы → `None`).
- `extract_jid(log_text)` — `gost-([a-zA-Z0-9_-]+)\.infoclinica\.lan`, токен в lower case, порт не участвует в извлечении.
- `resolve_clinic(jid, oid, license_jid_by_mo_uid=...)` — приоритет JID из URL, иначе OID → JID из лицензий.
- `build_record(log_text, kind_from_messages=..., kind_from_licenses=..., ...)` — полная запись для факта; при отсутствии `relatesToMessage` — вызов `on_staging_error` и `None`.

## Рекомендации по реализации пайплайна

1. **Пакеты**: накапливать батч кортежей `(logtext, kind_msg, kind_lic, mo_uid_map_row)` и вызывать `build_record` без повторного разбора XML там, где в логе нет `registerDocumentResult` / `relatesToMessage` (уже отфильтровано строкой).
2. **Обогащение**: один раз загрузить `EGISZ_LICENSES (MO_UID → JID)` в `dict` для `license_jid_by_mo_uid`; `JPERSONS` — в `dim_clinics` отдельным потоком.
3. **UPSERT**: `INSERT ... ON CONFLICT (relates_to_id) DO UPDATE` по всем полям факта, `processed_at = now()`.
