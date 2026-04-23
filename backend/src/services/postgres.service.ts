import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

import {
  AppConfig,
  ClinicDirectoryIssue,
  FirebirdConfigResponse,
  FirebirdConnectionConfig,
  PostgresConnectionIssue,
  StarSchemaLogRecord,
  SyncStatus
} from "../types";
import { buildDefaultFirebirdJoinQuery } from "../utils/validation";

const FIREBIRD_CONFIG_KEY = "firebird_connection";
const DEFAULT_FIREBIRD_CONNECTION = {
  host: "host.docker.internal",
  port: 3050,
  alias: "proxy_egisz",
  user: "sysdba",
  pass: "masterkey"
} as const;

type StoredFirebirdConfig = {
  host?: unknown;
  port?: unknown;
  alias?: unknown;
  path?: unknown;
  user?: unknown;
  pass?: unknown;
  password?: unknown;
  pageSize?: unknown;
  joinQuery?: unknown;
  isDefault?: unknown;
};

export class PostgresService {
  private readonly pool: Pool;
  private readonly schemaName: string;
  private static readonly ETL_LOCK_NAMESPACE = 48219;
  private static readonly ETL_LOCK_KEY = 1;
  private static readonly UPSERT_BATCH_SIZE = 500;
  private static readonly SEMD_DICTIONARY: Readonly<Record<string, string>> = {
    "40": "РџСЂРѕС‚РѕРєРѕР» С‚РµР»РµРјРµРґРёС†РёРЅСЃРєРѕР№ РєРѕРЅСЃСѓР»СЊС‚Р°С†РёРё",
    "43": "РќР°РїСЂР°РІР»РµРЅРёРµ РЅР° РіРѕСЃРїРёС‚Р°Р»РёР·Р°С†РёСЋ, РІРѕСЃСЃС‚Р°РЅРѕРІРёС‚РµР»СЊРЅРѕРµ Р»РµС‡РµРЅРёРµ, РѕР±СЃР»РµРґРѕРІР°РЅРёРµ, РєРѕРЅСЃСѓР»СЊС‚Р°С†РёСЋ",
    "63": "РњРµРґРёС†РёРЅСЃРєРѕРµ Р·Р°РєР»СЋС‡РµРЅРёРµ РѕР± РѕС‚СЃСѓС‚СЃС‚РІРёРё РјРµРґРёС†РёРЅСЃРєРёС… РїСЂРѕС‚РёРІРѕРїРѕРєР°Р·Р°РЅРёР№ Рє РІР»Р°РґРµРЅРёСЋ РѕСЂСѓР¶РёРµРј",
    "64": "РњРµРґРёС†РёРЅСЃРєРѕРµ Р·Р°РєР»СЋС‡РµРЅРёРµ РѕР± РѕС‚СЃСѓС‚СЃС‚РІРёРё РІ РѕСЂРіР°РЅРёР·РјРµ С‡РµР»РѕРІРµРєР° РЅР°СЂРєРѕС‚РёС‡РµСЃРєРёС… СЃСЂРµРґСЃС‚РІ, РїСЃРёС…РѕС‚СЂРѕРїРЅС‹С… РІРµС‰РµСЃС‚РІ Рё РёС… РјРµС‚Р°Р±РѕР»РёС‚РѕРІ",
    "65": "РЎРїСЂР°РІРєР° РґР»СЏ РїРѕР»СѓС‡РµРЅРёСЏ РїСѓС‚РµРІРєРё РЅР° СЃР°РЅР°С‚РѕСЂРЅРѕ-РєСѓСЂРѕСЂС‚РЅРѕРµ Р»РµС‡РµРЅРёРµ",
    "69": "РџСЂРѕС‚РѕРєРѕР» РіРµРјРѕС‚СЂР°РЅСЃС„СѓР·РёРё",
    "70": "РЎРїСЂР°РІРєР° Рѕ СЂРµР·СѓР»СЊС‚Р°С‚Р°С… С…РёРјРёРєРѕ-С‚РѕРєСЃРёРєРѕР»РѕРіРёС‡РµСЃРєРёС… РёСЃСЃР»РµРґРѕРІР°РЅРёР№",
    "73": "РЎРїСЂР°РІРєР° Рѕ СЃРѕСЃС‚РѕСЏРЅРёРё РЅР° СѓС‡РµС‚Рµ РІ РґРёСЃРїР°РЅСЃРµСЂРµ",
    "74": "РџСЂРѕС‚РѕРєРѕР» РїСЂРёР¶РёР·РЅРµРЅРЅРѕРіРѕ РїР°С‚РѕР»РѕРіРѕР°РЅР°С‚РѕРјРёС‡РµСЃРєРѕРіРѕ РёСЃСЃР»РµРґРѕРІР°РЅРёСЏ",
    "75": "РџСЂРѕС‚РѕРєРѕР» Р»Р°Р±РѕСЂР°С‚РѕСЂРЅРѕРіРѕ РёСЃСЃР»РµРґРѕРІР°РЅРёСЏ",
    "76": "РњРµРґРёС†РёРЅСЃРєРѕРµ СЃРІРёРґРµС‚РµР»СЊСЃС‚РІРѕ Рѕ СЂРѕР¶РґРµРЅРёРё",
    "78": "РўР°Р»РѕРЅ в„– 2 РЅР° РїРѕР»СѓС‡РµРЅРёРµ СЃРїРµС†РёР°Р»СЊРЅС‹С… С‚Р°Р»РѕРЅРѕРІ (РёРјРµРЅРЅС‹С… РЅР°РїСЂР°РІР»РµРЅРёР№) РЅР° РїСЂРѕРµР·Рґ Рє РјРµСЃС‚Сѓ Р»РµС‡РµРЅРёСЏ",
    "79": "РЎРїСЂР°РІРєР° Рѕ РїСЂРѕС…РѕР¶РґРµРЅРёРё РјРµРґРёС†РёРЅСЃРєРѕРіРѕ РѕСЃРІРёРґРµС‚РµР»СЊСЃС‚РІРѕРІР°РЅРёСЏ РІ РїСЃРёС…РѕРЅРµРІСЂРѕР»РѕРіРёС‡РµСЃРєРѕРј РґРёСЃРїР°РЅСЃРµСЂРµ",
    "80": "РЎРїСЂР°РІРєР° РѕР± РѕС‚СЃСѓС‚СЃС‚РІРёРё РєРѕРЅС‚Р°РєС‚РѕРІ СЃ РёРЅС„РµРєС†РёРѕРЅРЅС‹РјРё Р±РѕР»СЊРЅС‹РјРё",
    "81": "РЎРїСЂР°РІРєР° Рѕ РІСЂРµРјРµРЅРЅРѕР№ РЅРµС‚СЂСѓРґРѕСЃРїРѕСЃРѕР±РЅРѕСЃС‚Рё СЃС‚СѓРґРµРЅС‚Р°/СѓС‡Р°С‰РµРіРѕСЃСЏ (Р±РѕР»РµР·РЅСЊ, РєР°СЂР°РЅС‚РёРЅ)",
    "82": "РњРµРґР·Р°РєР»СЋС‡РµРЅРёРµ Рѕ РіСЂСѓРїРїРµ РґР»СЏ Р·Р°РЅСЏС‚РёР№ С„РёР·РєСѓР»СЊС‚СѓСЂРѕР№ РЅРµСЃРѕРІРµСЂС€РµРЅРЅРѕР»РµС‚РЅРµРіРѕ",
    "83": "РњРµРґРёС†РёРЅСЃРєРѕРµ Р·Р°РєР»СЋС‡РµРЅРёРµ РѕР± РѕС‚СЃСѓС‚СЃС‚РІРёРё РїСЂРѕС‚РёРІРѕРїРѕРєР°Р·Р°РЅРёР№ Рє Р·Р°РЅСЏС‚РёСЋ СЃРїРѕСЂС‚РѕРј",
    "84": "РњРµРґРёС†РёРЅСЃРєР°СЏ СЃРїСЂР°РІРєР° РІ Р±Р°СЃСЃРµР№РЅ",
    "86": "РќР°РїСЂР°РІР»РµРЅРёРµ Рє РјРµСЃС‚Сѓ Р»РµС‡РµРЅРёСЏ РґР»СЏ РїРѕР»СѓС‡РµРЅРёСЏ РјРµРґРёС†РёРЅСЃРєРѕР№ РїРѕРјРѕС‰Рё",
    "87": "РЎРїСЂР°РІРєР° Рѕ СЃРѕСЃС‚РѕСЏРЅРёРё Р·РґРѕСЂРѕРІСЊСЏ СЂРµР±РµРЅРєР°, РѕС‚СЉРµР·Р¶Р°СЋС‰РµРіРѕ РІ Р»Р°РіРµСЂСЊ (РѕС‚РґС‹С…/РѕР·РґРѕСЂРѕРІР»РµРЅРёРµ)",
    "88": "РњРµРґРёС†РёРЅСЃРєР°СЏ СЃРїСЂР°РІРєР° (РґР»СЏ РІС‹РµР·Р¶Р°СЋС‰РµРіРѕ Р·Р° РіСЂР°РЅРёС†Сѓ)",
    "93": "РџСЂРѕС‚РѕРєРѕР» С†РёС‚РѕР»РѕРіРёС‡РµСЃРєРѕРіРѕ РёСЃСЃР»РµРґРѕРІР°РЅРёСЏ",
    "96": "РЎРІРµРґРµРЅРёСЏ Рѕ СЂРµР·СѓР»СЊС‚Р°С‚Р°С… РґРёСЃРїР°РЅСЃРµСЂРёР·Р°С†РёРё РёР»Рё РїСЂРѕС„. РѕСЃРјРѕС‚СЂР°",
    "100": "РЎРїСЂР°РІРєР° РѕР± РѕРїР»Р°С‚Рµ РјРµРґРёС†РёРЅСЃРєРёС… СѓСЃР»СѓРі РґР»СЏ РЅР°Р»РѕРіРѕРІС‹С… РѕСЂРіР°РЅРѕРІ Р Р¤",
    "101": "РњРµРґР·Р°РєР»СЋС‡РµРЅРёРµ Рѕ РґРѕРїСѓСЃРєРµ Рє СЂР°Р±РѕС‚Р°Рј РЅР° РІС‹СЃРѕС‚Рµ / РѕР±СЃР»СѓР¶РёРІР°РЅРёСЋ РїРѕРґСЉРµРјРЅС‹С… СЃРѕРѕСЂСѓР¶РµРЅРёР№",
    "102": "РЎРїСЂР°РІРєР° РѕР± РѕС‚РєР°Р·Рµ РІ РЅР°РїСЂР°РІР»РµРЅРёРё РЅР° РњРЎР­",
    "103": "РњРµРґР·Р°РєР»СЋС‡РµРЅРёРµ РїРѕ СЂРµР·СѓР»СЊС‚Р°С‚Р°Рј РїСЂРµРґРІР°СЂРёС‚РµР»СЊРЅРѕРіРѕ (РїРµСЂРёРѕРґРёС‡РµСЃРєРѕРіРѕ) РјРµРґРѕСЃРјРѕС‚СЂР°",
    "104": "Р­РєСЃС‚СЂРµРЅРЅРѕРµ РёР·РІРµС‰РµРЅРёРµ РѕР± РёРЅС„РµРєС†РёРѕРЅРЅРѕРј Р·Р°Р±РѕР»РµРІР°РЅРёРё / СЂРµР°РєС†РёРё РЅР° РїСЂРёРІРёРІРєСѓ",
    "105": "РЎРµСЂС‚РёС„РёРєР°С‚ РїСЂРѕС„РёР»Р°РєС‚РёС‡РµСЃРєРёС… РїСЂРёРІРёРІРѕРє",
    "106": "РЎРїСЂР°РІРєР° Рѕ РїРѕСЃС‚Р°РЅРѕРІРєРµ РЅР° СѓС‡РµС‚ РїРѕ Р±РµСЂРµРјРµРЅРЅРѕСЃС‚Рё",
    "107": "РЎРїСЂР°РІРєР° РґРѕРЅРѕСЂСѓ РѕР± РѕСЃРІРѕР±РѕР¶РґРµРЅРёРё РѕС‚ СЂР°Р±РѕС‚С‹",
    "110": "РџСЂРѕС‚РѕРєРѕР» РёРЅСЃС‚СЂСѓРјРµРЅС‚Р°Р»СЊРЅРѕРіРѕ РёСЃСЃР»РµРґРѕРІР°РЅРёСЏ",
    "111": "РџСЂРѕС‚РѕРєРѕР» РєРѕРЅСЃСѓР»СЊС‚Р°С†РёРё РІ СЂР°РјРєР°С… РґРёСЃРїР°РЅСЃРµСЂРЅРѕРіРѕ РЅР°Р±Р»СЋРґРµРЅРёСЏ",
    "114": "РЎРІРµРґРµРЅРёСЏ РјРµРґРёС†РёРЅСЃРєРѕРіРѕ СЃРІРёРґРµС‚РµР»СЊСЃС‚РІР° Рѕ РїРµСЂРёРЅР°С‚Р°Р»СЊРЅРѕР№ СЃРјРµСЂС‚Рё (Р±СѓРјР°Р¶РЅР°СЏ С„РѕСЂРјР°)",
    "115": "РљР°СЂС‚Р° РІС‹Р·РѕРІР° СЃРєРѕСЂРѕР№ РјРµРґРёС†РёРЅСЃРєРѕР№ РїРѕРјРѕС‰Рё",
    "116": "РЈРІРµРґРѕРјР»РµРЅРёРµ Рѕ РІС‹СЏРІР»РµРЅРёРё РїСЂРѕС‚РёРІРѕРїРѕРєР°Р·Р°РЅРёР№ Рє РІР»Р°РґРµРЅРёСЋ РѕСЂСѓР¶РёРµРј",
    "118": "РЎРІРµРґРµРЅРёСЏ РјРµРґРёС†РёРЅСЃРєРѕРіРѕ СЃРІРёРґРµС‚РµР»СЊСЃС‚РІР° Рѕ СЂРѕР¶РґРµРЅРёРё (Р±СѓРјР°Р¶РЅР°СЏ С„РѕСЂРјР°)",
    "119": "РџСЂРѕС‚РѕРєРѕР» РєРѕРЅСЃСѓР»СЊС‚Р°С†РёРё",
    "121": "РќР°РїСЂР°РІР»РµРЅРёРµ РЅР° РјРµРґРёРєРѕ-СЃРѕС†РёР°Р»СЊРЅСѓСЋ СЌРєСЃРїРµСЂС‚РёР·Сѓ (РњРЎР­)",
    "122": "РЎРІРµРґРµРЅРёСЏ Рѕ СЂРµР·СѓР»СЊС‚Р°С‚Р°С… РґРёСЃРїР°РЅСЃРµСЂРёР·Р°С†РёРё РёР»Рё РїСЂРѕС„. РѕСЃРјРѕС‚СЂР° (Р°РєС‚СѓР°Р»СЊРЅР°СЏ СЂРµРґ.)",
    "123": "РќР°РїСЂР°РІР»РµРЅРёРµ РЅР° РіРѕСЃРїРёС‚Р°Р»РёР·Р°С†РёСЋ РґР»СЏ РѕРєР°Р·Р°РЅРёСЏ Р’РњРџ",
    "124": "РќР°РїСЂР°РІР»РµРЅРёРµ РЅР° РіРѕСЃРїРёС‚Р°Р»РёР·Р°С†РёСЋ РґР»СЏ РѕРєР°Р·Р°РЅРёСЏ СЃРїРµС†РёР°Р»РёР·РёСЂРѕРІР°РЅРЅРѕР№ РјРµРґРїРѕРјРѕС‰Рё",
    "127": "РњРµРґРёС†РёРЅСЃРєРѕРµ СЃРІРёРґРµС‚РµР»СЊСЃС‚РІРѕ Рѕ РїРµСЂРёРЅР°С‚Р°Р»СЊРЅРѕР№ СЃРјРµСЂС‚Рё",
    "129": "Р­РїРёРєСЂРёР· РїРѕ СЂРµР·СѓР»СЊС‚Р°С‚Р°Рј РґРёСЃРїР°РЅСЃРµСЂРёР·Р°С†РёРё / РїСЂРѕС„. РѕСЃРјРѕС‚СЂР°",
    "131": "РќР°РїСЂР°РІР»РµРЅРёРµ Рє РјРµСЃС‚Сѓ Р»РµС‡РµРЅРёСЏ РґР»СЏ РїРѕР»СѓС‡РµРЅРёСЏ РјРµРґРёС†РёРЅСЃРєРѕР№ РїРѕРјРѕС‰Рё",
    "132": "РўР°Р»РѕРЅ РЅР° РѕРєР°Р·Р°РЅРёРµ Р’РњРџ",
    "133": "Р­С‚Р°РїРЅС‹Р№ СЌРїРёРєСЂРёР·",
    "134": "РџСЂРµРґРѕРїРµСЂР°С†РёРѕРЅРЅС‹Р№ СЌРїРёРєСЂРёР·",
    "135": "Р’С‹РїРёСЃРєР° РёР· РёСЃС‚РѕСЂРёРё Р±РѕР»РµР·РЅРё",
    "136": "Р­РєСЃС‚СЂРµРЅРЅРѕРµ РёР·РІРµС‰РµРЅРёРµ Рѕ СЃР»СѓС‡Р°Рµ РѕСЃС‚СЂРѕРіРѕ РѕС‚СЂР°РІР»РµРЅРёСЏ С…РёРјРёС‡РµСЃРєРѕР№ СЌС‚РёРѕР»РѕРіРёРё",
    "137": "РЎР°РЅР°С‚РѕСЂРЅРѕ-РєСѓСЂРѕСЂС‚РЅР°СЏ РєР°СЂС‚Р°",
    "138": "РџСЂРѕРіСЂР°РјРјР° РґРѕРїРѕР»РЅРёС‚РµР»СЊРЅРѕРіРѕ РѕР±СЃР»РµРґРѕРІР°РЅРёСЏ РіСЂР°Р¶РґР°РЅРёРЅР° (Р¤Р‘РњРЎР­)",
    "139": "РЎРїСЂР°РІРєР° Рѕ СЂРµР·СѓР»СЊС‚Р°С‚Р°С… С…РёРјРёРєРѕ-С‚РѕРєСЃРёРєРѕР»РѕРіРёС‡РµСЃРєРёС… РёСЃСЃР»РµРґРѕРІР°РЅРёР№",
    "141": "Р›СЊРіРѕС‚РЅС‹Р№ СЂРµС†РµРїС‚ РЅР° Р»РµРєР°СЂСЃС‚РІРµРЅРЅС‹Р№ РїСЂРµРїР°СЂР°С‚ / РёР·Рґ. РјРµРґРЅР°Р·РЅР°С‡РµРЅРёСЏ",
    "142": "Р—Р°РєР»СЋС‡РµРЅРёРµ РѕР± СѓСЃС‚Р°РЅРѕРІР»РµРЅРёРё С„Р°РєС‚Р° РїРѕСЃС‚РІР°РєС†РёРЅР°Р»СЊРЅРѕРіРѕ РѕСЃР»РѕР¶РЅРµРЅРёСЏ",
    "143": "Р—Р°РєР»СЋС‡РµРЅРёРµ Рѕ РЅСѓР¶РґР°РµРјРѕСЃС‚Рё РїСЂРµСЃС‚Р°СЂРµР»РѕРіРѕ РіСЂР°Р¶РґР°РЅРёРЅР° РІ РїРѕСЃС‚РѕСЏРЅРЅРѕРј СѓС…РѕРґРµ",
    "144": "Р—Р°РєР»СЋС‡РµРЅРёРµ РІСЂР°С‡РµР±РЅРѕР№ РєРѕРјРёСЃСЃРёРё Рѕ РЅСѓР¶РґР°РµРјРѕСЃС‚Рё РІРµС‚РµСЂР°РЅР° РІ РїСЂРѕС‚РµР·Р°С…",
    "145": "РЎРїСЂР°РІРєР° Рѕ РїРѕРєР°Р·Р°РЅРёСЏС…, РїРѕ РєРѕС‚РѕСЂС‹Рј СЂРµР±РµРЅРѕРє РЅРµ РїРѕСЃРµС‰Р°РµС‚ Р”РћРЈ РІ РїРµСЂРёРѕРґ СѓС‡РµР±РЅРѕРіРѕ РїСЂРѕС†РµСЃСЃР°",
    "146": "РўР°Р»РѕРЅ в„– 2 РЅР° РїРѕР»СѓС‡РµРЅРёРµ СЃРїРµС†С‚Р°Р»РѕРЅРѕРІ РЅР° РїСЂРѕРµР·Рґ Рє РјРµСЃС‚Сѓ Р»РµС‡РµРЅРёСЏ",
    "147": "Р’С‹РїРёСЃРЅРѕР№ СЌРїРёРєСЂРёР· РІ СЃС‚Р°С†РёРѕРЅР°СЂРµ",
    "148": "Р РµС†РµРїС‚ РЅР° Р»РµРєР°СЂСЃС‚РІРµРЅРЅС‹Р№ РїСЂРµРїР°СЂР°С‚",
    "149": "РњРµРґР·Р°РєР»СЋС‡РµРЅРёРµ Рѕ РіСЂСѓРїРїРµ РґР»СЏ Р·Р°РЅСЏС‚РёР№ С„РёР·РєСѓР»СЊС‚СѓСЂРѕР№ РЅРµСЃРѕРІРµСЂС€РµРЅРЅРѕР»РµС‚РЅРµРіРѕ (Р°РєС‚СѓР°Р»СЊРЅРѕРµ)",
    "150": "РњРµРґРёС†РёРЅСЃРєР°СЏ СЃРїСЂР°РІРєР° РІ Р±Р°СЃСЃРµР№РЅ (Р°РєС‚СѓР°Р»СЊРЅР°СЏ)",
    "151": "РЎРїСЂР°РІРєР° РґР»СЏ РїРѕР»СѓС‡РµРЅРёСЏ РїСѓС‚РµРІРєРё РЅР° СЃР°РЅР°С‚РѕСЂРЅРѕ-РєСѓСЂРѕСЂС‚РЅРѕРµ Р»РµС‡РµРЅРёРµ",
    "152": "РњРµРґРёС†РёРЅСЃРєРѕРµ Р·Р°РєР»СЋС‡РµРЅРёРµ РѕР± РѕС‚СЃСѓС‚СЃС‚РІРёРё РїСЂРѕС‚РёРІРѕРїРѕРєР°Р·Р°РЅРёР№ Рє Р·Р°РЅСЏС‚РёСЋ СЃРїРѕСЂС‚РѕРј",
    "153": "РњРµРґРёС†РёРЅСЃРєР°СЏ СЃРїСЂР°РІРєР° (РґР»СЏ РІС‹РµР·Р¶Р°СЋС‰РµРіРѕ Р·Р° РіСЂР°РЅРёС†Сѓ)",
    "154": "РЎРїСЂР°РІРєР° РѕР± РѕС‚СЃСѓС‚СЃС‚РІРёРё РєРѕРЅС‚Р°РєС‚РѕРІ СЃ РёРЅС„РµРєС†РёРѕРЅРЅС‹РјРё Р±РѕР»СЊРЅС‹РјРё",
    "155": "РЎРїСЂР°РІРєР° РѕР± РѕС‚СЃСѓС‚СЃС‚РІРёРё РїСЂРѕС‚РёРІРѕРїРѕРєР°Р·Р°РЅРёР№ РґР»СЏ СЂР°Р±РѕС‚С‹ СЃ РіРѕСЃС‚Р°Р№РЅРѕР№",
    "156": "Р—Р°РєР»СЋС‡РµРЅРёРµ РґР»СЏ РіСЂР°Р¶РґР°РЅ, РЅР°РјРµСЂРµРІР°СЋС‰РёС…СЃСЏ СѓСЃС‹РЅРѕРІРёС‚СЊ/СѓРґРѕС‡РµСЂРёС‚СЊ РґРµС‚РµР№",
    "158": "Р’С‹РїРёСЃРєР° РёР· РїСЂРѕС‚РѕРєРѕР»Р° СЂРµС€РµРЅРёСЏ РІСЂР°С‡РµР±РЅРѕР№ РєРѕРјРёСЃСЃРёРё",
    "159": "РЎС‚Р°С‚РёСЃС‚РёС‡РµСЃРєР°СЏ РєР°СЂС‚Р° РІС‹Р±С‹РІС€РµРіРѕ РёР· СЃС‚Р°С†РёРѕРЅР°СЂР°",
    "160": "РџСЂРѕС‚РѕРєРѕР» РўРњРљ РґР»СЏ С‚СЂР°РЅСЃРіСЂР°РЅРёС‡РЅС‹С… СЂРµС€РµРЅРёР№",
    "161": "РЎР°РЅР°С‚РѕСЂРЅРѕ-РєСѓСЂРѕСЂС‚РЅР°СЏ РєР°СЂС‚Р° РґР»СЏ РґРµС‚РµР№",
    "163": "РџСЂРѕС‚РѕРєРѕР» РјРµРґРёС†РёРЅСЃРєРѕР№ РјР°РЅРёРїСѓР»СЏС†РёРё",
    "164": "Р­РєСЃС‚СЂРµРЅРЅРѕРµ РёР·РІРµС‰РµРЅРёРµ РѕР± РёРЅС„РµРєС†РёРѕРЅРЅРѕРј Р·Р°Р±РѕР»РµРІР°РЅРёРё (Р°РєС‚СѓР°Р»СЊРЅРѕРµ)",
    "169": "РЎРїСЂР°РІРєР° Рѕ РІСЂРµРјРµРЅРЅРѕР№ РЅРµС‚СЂСѓРґРѕСЃРїРѕСЃРѕР±РЅРѕСЃС‚Рё СЃС‚СѓРґРµРЅС‚Р° (СЂРµРґ. 4)",
    "170": "РЎРµСЂС‚РёС„РёРєР°С‚ РїСЂРѕС„РёР»Р°РєС‚РёС‡РµСЃРєРёС… РїСЂРёРІРёРІРѕРє (СЂРµРґ. 2)",
    "171": "РњРµРґР·Р°РєР»СЋС‡РµРЅРёРµ Рѕ РЅР°Р»РёС‡РёРё/РѕС‚СЃСѓС‚СЃС‚РІРёРё РїСЂРѕС‚РёРІРѕРїРѕРєР°Р·Р°РЅРёР№ Сѓ РІРѕРґРёС‚РµР»РµР№ РўРЎ",
    "172": "РЎРїСЂР°РІРєР° Рѕ СЃРѕСЃС‚РѕСЏРЅРёРё РЅР° СѓС‡РµС‚Рµ РІ РґРёСЃРїР°РЅСЃРµСЂРµ"
  };

  constructor(private readonly config: AppConfig["postgres"]) {
    this.schemaName = this.validateSchemaName(config.schema);
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 60000
    });
  }

  private buildSemdNameSql(columnRef: string): string {
    const branches = Object.entries(PostgresService.SEMD_DICTIONARY)
      .map(([code, name]) => `WHEN ${columnRef} = '${code}' THEN '${name.replace(/'/g, "''")}'`)
      .join("\n          ");

    return `
        CASE
          ${branches}
          ELSE NULL
        END
    `;
  }

  private buildNormalizedErrorTextSql(columnRef: string): string {
    return `regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              convert_from(convert_to(${columnRef}, 'UTF8'), 'UTF8'),
              '\\b(?:\\d{1,3}\\.){3}\\d{1,3}(?::\\d+)?\\b',
              '[IP]',
              'gi'
            ),
            '(?:[[:alnum:]](?:[[:alnum:]-]{0,61}[[:alnum:]])?\\.)+[[:alpha:]]{2,}(?::\\d+)?',
            '[HOST]',
            'gi'
          ),
          '\\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\b',
          '[ID]',
          'gi'
        ),
        '\\b\\d{6,}\\b',
        '[ID]',
        'g'
      ),
      '\\s+',
      ' ',
      'g'
    )`;
  }

  private buildBusinessErrorCategorySql(columnRef: string): string {
    return `CASE
      WHEN ${columnRef} ~* 'cvc-|xsd' THEN 'Ошибка валидации XSD'
      WHEN ${columnRef} ~* '(^|[^[:alnum:]_])oid([^[:alnum:]_]|$)|справочник|нси' THEN 'Ошибка заполнения реквизитов/НСИ'
      WHEN ${columnRef} ~* 'timeout|504|connection|refused' THEN 'Ошибка связи'
      WHEN ${columnRef} ~* 'дубликат|зарегистрирован|логическ(ая|ой)?\\s+ошибк' THEN 'Ошибка логики ЕГИСЗ'
      ELSE 'Прочие ошибки'
    END`;
  }

  async ensureSchema(): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${this.schemaName}`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.schemaName}.app_config (
          config_key TEXT PRIMARY KEY,
          config_value JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        ALTER TABLE ${this.schemaName}.app_config
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.schemaName}.dim_clinics (
          clinic_id SERIAL PRIMARY KEY,
          jid BIGINT NOT NULL,
          mo_uid VARCHAR(256) NOT NULL UNIQUE,
          mo_domen VARCHAR(256),
          jname VARCHAR(255),
          is_verified BOOLEAN NOT NULL DEFAULT TRUE
        )
      `);
      await client.query(`
        ALTER TABLE ${this.schemaName}.dim_clinics
        ADD COLUMN IF NOT EXISTS mo_domen VARCHAR(256)
      `);
      await client.query(`
        ALTER TABLE ${this.schemaName}.dim_clinics
        ADD COLUMN IF NOT EXISTS jname VARCHAR(255)
      `);
      await client.query(`
        ALTER TABLE ${this.schemaName}.dim_clinics
        ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT TRUE
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.schemaName}.dim_services (
          service_id SERIAL PRIMARY KEY,
          kind VARCHAR(255) NOT NULL UNIQUE,
          service_type VARCHAR(64) NOT NULL,
          description VARCHAR(255)
        )
      `);
      await this.dropAnalyticsViews(client);
      await client.query(`
        ALTER TABLE ${this.schemaName}.dim_services
        ALTER COLUMN kind TYPE VARCHAR(255) USING kind::text
      `);
      await client.query(`
        ALTER TABLE ${this.schemaName}.dim_services
        ALTER COLUMN service_type TYPE VARCHAR(64) USING service_type::text
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.schemaName}.fact_transactions (
          transaction_id BIGSERIAL PRIMARY KEY,
          clinic_id INT NOT NULL REFERENCES ${this.schemaName}.dim_clinics(clinic_id),
          service_id INT NOT NULL REFERENCES ${this.schemaName}.dim_services(service_id),
          original_log_id BIGINT UNIQUE,
          transaction_date TIMESTAMP NOT NULL,
          status VARCHAR(20) NOT NULL,
          error_category VARCHAR(50),
          error_code VARCHAR(255),
          error_message TEXT,
          error_text TEXT,
          CONSTRAINT chk_fact_transactions_status CHECK (status IN ('success', 'error')),
          CONSTRAINT chk_fact_transactions_error_category CHECK (
            (status = 'error' AND error_category IS NOT NULL) OR
            (status = 'success' AND error_category IS NULL)
          )
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.schemaName}.egisz_errors (
          error_id BIGSERIAL PRIMARY KEY,
          original_log_id BIGINT NOT NULL UNIQUE,
          clinic_id INT,
          transaction_date TIMESTAMP NOT NULL,
          error_category VARCHAR(50) NOT NULL,
          error_text TEXT NOT NULL,
          hostname VARCHAR(256)
        )
      `);
      await client.query(`
        ALTER TABLE ${this.schemaName}.egisz_errors
        ADD COLUMN IF NOT EXISTS clinic_id INT
      `);
      await client.query(`
        ALTER TABLE ${this.schemaName}.egisz_errors
        ADD COLUMN IF NOT EXISTS hostname VARCHAR(256)
      `);
      await client.query(`
        ALTER TABLE ${this.schemaName}.fact_transactions
        ADD COLUMN IF NOT EXISTS error_code VARCHAR(255)
      `);
      await client.query(`
        ALTER TABLE ${this.schemaName}.fact_transactions
        ADD COLUMN IF NOT EXISTS error_message TEXT
      `);


      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.schemaName}.dim_error_costs (
          error_cost_id SERIAL PRIMARY KEY,
          error_category VARCHAR(50) NOT NULL UNIQUE,
          error_subcategory VARCHAR(50),
          base_cost_per_error DECIMAL(10,2) NOT NULL DEFAULT 0.00,
          escalation_multiplier DECIMAL(3,2) NOT NULL DEFAULT 1.00,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await this.migrateClinicDirectory(client);
      await this.normalizeErrorCategories(client);
      await this.backfillEgiszErrorClinicIds(client);
      await this.enforceEgiszErrorClinicForeignKey(client);
      await this.createIndexes(client);
      await this.cleanupTechnicalData(client);
      await this.createAnalyticsViews(client);

      await client.query("COMMIT");
      await this.verifySchemaIntegrity();
    } catch (error) {
      await this.rollbackQuietly(client);
      throw this.toDatabaseError(error, "Failed to ensure PostgreSQL schema");
    } finally {
      client.release();
    }
  }

  async initializeDefaultFirebirdConfig(): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      `
        INSERT INTO ${this.schemaName}.app_config (config_key, config_value, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (config_key) DO NOTHING
      `,
      [FIREBIRD_CONFIG_KEY, JSON.stringify({ ...DEFAULT_FIREBIRD_CONNECTION, isDefault: true })]
    );
  }

  async saveFirebirdConfig(config: FirebirdConnectionConfig): Promise<void> {
    await this.ensureSchema();
    const storedConfig = {
      host: config.host,
      port: config.port,
      alias: config.alias,
      user: config.user,
      pass: config.password,
      isDefault: false
    };

    await this.pool.query(
      `
        INSERT INTO ${this.schemaName}.app_config (config_key, config_value, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (config_key) DO UPDATE
        SET
          config_value = EXCLUDED.config_value,
          updated_at = NOW()
      `,
      [FIREBIRD_CONFIG_KEY, JSON.stringify(storedConfig)]
    );
  }

  async initializeDefaultErrorCosts(): Promise<void> {
    await this.ensureSchema();

    const defaultCosts = [
      { error_category: 'network', error_subcategory: null, base_cost_per_error: 50.00, escalation_multiplier: 1.00 },
      { error_category: 'async', error_subcategory: null, base_cost_per_error: 25.00, escalation_multiplier: 1.00 },
      { error_category: 'other', error_subcategory: 'auth', base_cost_per_error: 100.00, escalation_multiplier: 2.00 },
      { error_category: 'other', error_subcategory: 'timeout', base_cost_per_error: 75.00, escalation_multiplier: 1.50 },
      { error_category: 'other', error_subcategory: 'connection_refused', base_cost_per_error: 60.00, escalation_multiplier: 1.20 },
      { error_category: 'other', error_subcategory: 'proxy', base_cost_per_error: 40.00, escalation_multiplier: 1.00 },
      { error_category: 'other', error_subcategory: 'egisz', base_cost_per_error: 80.00, escalation_multiplier: 1.80 },
      { error_category: 'other', error_subcategory: 'validation', base_cost_per_error: 30.00, escalation_multiplier: 1.00 },
      { error_category: 'other', error_subcategory: 'unknown', base_cost_per_error: 45.00, escalation_multiplier: 1.10 }
    ];

    for (const cost of defaultCosts) {
      await this.pool.query(
        `
          INSERT INTO ${this.schemaName}.dim_error_costs (
            error_category, error_subcategory, base_cost_per_error, escalation_multiplier, is_active
          )
          VALUES ($1, $2, $3, $4, TRUE)
          ON CONFLICT (error_category) DO UPDATE SET
            error_subcategory = EXCLUDED.error_subcategory,
            base_cost_per_error = EXCLUDED.base_cost_per_error,
            escalation_multiplier = EXCLUDED.escalation_multiplier,
            updated_at = NOW()
          WHERE ${this.schemaName}.dim_error_costs.error_subcategory IS NULL
             OR ${this.schemaName}.dim_error_costs.error_subcategory = EXCLUDED.error_subcategory
        `,
        [cost.error_category, cost.error_subcategory, cost.base_cost_per_error, cost.escalation_multiplier]
      );
    }
  }

  async getFirebirdConfig(): Promise<FirebirdConnectionConfig | null> {
    await this.ensureSchema();

    const result = await this.pool.query<{ config_value: StoredFirebirdConfig }>(
      `
        SELECT config_value
        FROM ${this.schemaName}.app_config
        WHERE config_key = $1
      `,
      [FIREBIRD_CONFIG_KEY]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.normalizeStoredFirebirdConnection(result.rows[0].config_value);
  }

  async getFirebirdConfigState(): Promise<FirebirdConfigResponse | null> {
    await this.ensureSchema();

    const result = await this.pool.query<{ config_value: StoredFirebirdConfig }>(
      `
        SELECT config_value
        FROM ${this.schemaName}.app_config
        WHERE config_key = $1
      `,
      [FIREBIRD_CONFIG_KEY]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.normalizeStoredFirebirdConfigView(result.rows[0].config_value);
  }

  async upsertStarSchemaBatch(records: StarSchemaLogRecord[]): Promise<number> {
    if (records.length === 0) {
      return 0;
    }

    let inserted = 0;

    for (let index = 0; index < records.length; index += PostgresService.UPSERT_BATCH_SIZE) {
      const chunk = records.slice(index, index + PostgresService.UPSERT_BATCH_SIZE);
      inserted += await this.upsertStarSchemaChunk(chunk);
    }

    return inserted;
  }

  private async upsertStarSchemaChunk(records: StarSchemaLogRecord[]): Promise<number> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      for (const record of records) {
        const clinicId = await this.upsertClinic(client, record);
        const serviceId = await this.upsertService(client, record);
        await this.upsertFactTransaction(client, record, clinicId, serviceId);
        await this.upsertEgiszError(client, record, clinicId);
      }

      await client.query("COMMIT");
      return records.length;
    } catch (error) {
      await this.rollbackQuietly(client);

      throw new Error(
        `Failed to write ETL batch into PostgreSQL star schema. ${error instanceof Error ? error.message : "Unknown write error"}`
      );
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    try {
      await this.pool.query("SELECT 1");
    } catch (error) {
      throw this.toDatabaseError(error, "PostgreSQL ping failed");
    }
  }

  async verifySchemaIntegrity(): Promise<void> {
    const requiredTables = ["dim_clinics", "fact_transactions", "dim_error_costs"] as const;
    const result = await this.pool.query<{ table_name: string }>(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1
          AND table_name = ANY($2::text[])
      `,
      [this.schemaName, requiredTables]
    );

    const existingTables = new Set(result.rows.map((row) => row.table_name));
    const missingTables = requiredTables.filter((tableName) => !existingTables.has(tableName));

    if (missingTables.length > 0) {
      throw new Error(
        `Schema integrity verification failed for ${this.schemaName}. Missing tables: ${missingTables.join(", ")}`
      );
    }
  }

  async getSystemHealth(): Promise<{ postgres: "ok"; activeClinics: number }> {
    await this.ensureSchema();
    await this.ping();

    const result = await this.pool.query<{ active_clinics: string }>(
      `
        SELECT COUNT(DISTINCT clinic_id)::BIGINT AS active_clinics
        FROM ${this.schemaName}.fact_transactions
        WHERE transaction_date >= NOW() - INTERVAL '24 hours'
      `
    );

    return {
      postgres: "ok",
      activeClinics: Number(result.rows[0]?.active_clinics ?? 0)
    };
  }

  async getSyncStatus(): Promise<SyncStatus> {
    try {
      await this.ping();

      const result = await this.pool.query<{
        total_records: string;
        success_records: string;
        error_records: string;
        last_sync_date: Date | null;
      }>(
        `
          SELECT
            COUNT(*)::BIGINT AS total_records,
            COUNT(*) FILTER (WHERE status = 'success')::BIGINT AS success_records,
            COUNT(*) FILTER (WHERE status = 'error')::BIGINT AS error_records,
            MAX(transaction_date) AS last_sync_date
          FROM ${this.schemaName}.fact_transactions
        `
      );

      const row = result.rows[0];

      return {
        totalRecords: Number(row?.total_records ?? 0),
        successRecords: Number(row?.success_records ?? 0),
        errorRecords: Number(row?.error_records ?? 0),
        lastSyncDate: row?.last_sync_date ? row.last_sync_date.toISOString() : null,
        degraded: false
      };
    } catch (error) {
      const issue = this.inspectConnectionIssue(error);
      return {
        totalRecords: 0,
        successRecords: 0,
        errorRecords: 0,
        lastSyncDate: null,
        degraded: true,
        message: issue.message
      };
    }
  }

  inspectConnectionIssue(error: unknown): PostgresConnectionIssue {
    const message = error instanceof Error ? error.message : "Unknown PostgreSQL error";

    if (/password authentication failed|28p01/i.test(message)) {
      return {
        code: "authentication_failed",
        message,
        userHint:
          `РџСЂРѕРІРµСЂСЊС‚Рµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ/РїР°СЂРѕР»СЊ PostgreSQL РґР»СЏ СЃСѓС‰РµСЃС‚РІСѓСЋС‰РµРіРѕ postgres_data. ` +
          `РџРµСЂРµРјРµРЅРЅС‹Рµ РѕРєСЂСѓР¶РµРЅРёСЏ РЅРµ РїРµСЂРµРѕРїСЂРµРґРµР»СЏСЋС‚ СѓР¶Рµ СЃРѕР·РґР°РЅРЅС‹С… РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№.`
      };
    }

    if (/does not exist|connection refused|timeout expired|getaddrinfo|ecconnrefused|3d000/i.test(message)) {
      return {
        code: "database_unavailable",
        message,
        userHint: "РџСЂРѕРІРµСЂСЊС‚Рµ РґРѕСЃС‚СѓРїРЅРѕСЃС‚СЊ РєРѕРЅС‚РµР№РЅРµСЂР° db, РёРјСЏ Р±Р°Р·С‹ Рё СЃРµС‚РµРІС‹Рµ РїР°СЂР°РјРµС‚СЂС‹ РїРѕРґРєР»СЋС‡РµРЅРёСЏ."
      };
    }

    if (/ensure PostgreSQL schema|clinic_id after migration|relation .* does not exist/i.test(message)) {
      return {
        code: "schema_migration_failed",
        message,
        userHint: "РџСЂРѕРІРµСЂСЊС‚Рµ СЃРѕСЃС‚РѕСЏРЅРёРµ СЃСѓС‰РµСЃС‚РІСѓСЋС‰РµРіРѕ postgres_data Рё РєРѕРЅСЃРёСЃС‚РµРЅС‚РЅРѕСЃС‚СЊ РёСЃС‚РѕСЂРёС‡РµСЃРєРёС… РґР°РЅРЅС‹С… РїРµСЂРµРґ РјРёРіСЂР°С†РёРµР№."
      };
    }

    return {
      code: "unknown",
      message,
      userHint: null
    };
  }

  async query<TResult extends QueryResultRow>(
    sql: string,
    params: unknown[] = []
  ): Promise<QueryResult<TResult>> {
    return this.pool.query<TResult>(sql, params);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  getQualifiedTableName(
    tableName: "app_config" | "dim_clinics" | "dim_services" | "fact_transactions" | "egisz_errors" | "dim_error_costs" |
    "view_daily_summary" | "view_error_analysis" | "view_clinic_sla" | "v_unified_analytics" | 
    "v_support_economic_metrics" | "v_vpn_node_stability" | "v_clinic_performance"
  ): string {
    return `${this.schemaName}.${tableName}`;
  }

  async withEtlLock<T>(callback: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();

    try {
      const lockResult = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock($1, $2) AS locked",
        [PostgresService.ETL_LOCK_NAMESPACE, PostgresService.ETL_LOCK_KEY]
      );

      if (!lockResult.rows[0]?.locked) {
        throw new Error("ETL is already running");
      }

      return await callback();
    } finally {
      try {
        await client.query("SELECT pg_advisory_unlock($1, $2)", [
          PostgresService.ETL_LOCK_NAMESPACE,
          PostgresService.ETL_LOCK_KEY
        ]);
      } catch {
        // Ignore unlock errors on shutdown paths.
      }

      client.release();
    }
  }

  async listUnverifiedClinics(): Promise<ClinicDirectoryIssue[]> {
    await this.ensureSchema();

    const result = await this.pool.query<ClinicDirectoryIssue>(
      `
        SELECT
          clinic_id AS "clinicId",
          jid,
          mo_uid AS "moUid",
          mo_domen AS "moDomen",
          jname,
          is_verified AS "isVerified"
        FROM ${this.schemaName}.dim_clinics
        WHERE is_verified = FALSE
        ORDER BY COALESCE(mo_domen, mo_uid) ASC
      `
    );

    return result.rows;
  }

  private async cleanupTechnicalData(client: PoolClient): Promise<void> {
    await client.query(
      `
        DELETE FROM ${this.schemaName}.dim_clinics
        WHERE is_verified = FALSE
          AND LOWER(COALESCE(mo_domen, '')) = ANY($1::text[])
      `,
      [["127.0.0.1", "localhost", "host.docker.internal"]]
    );
  }

  private async upsertClinic(client: PoolClient, record: StarSchemaLogRecord): Promise<number> {
    const existingClinicId =
      (record.clinic.jid !== 0 ? await this.findClinicIdByJid(client, record.clinic.jid) : null) ??
      (record.clinic.moDomen ? await this.findClinicIdByDomain(client, record.clinic.moDomen) : null);

    if (existingClinicId !== null) {
      await client.query(
        `
          UPDATE ${this.schemaName}.dim_clinics
          SET
            jid = CASE WHEN $2 <> 0 THEN $2 ELSE jid END,
            mo_uid = CASE
              WHEN is_verified = FALSE AND $5 = TRUE THEN $3
              ELSE mo_uid
            END,
            mo_domen = COALESCE($6, mo_domen),
            jname = CASE
              WHEN $4::VARCHAR(255) IS NOT NULL AND ($5 = TRUE OR jname IS NULL OR jname LIKE 'РќРµРёР·РІРµСЃС‚РЅР°СЏ РєР»РёРЅРёРєР° (%)')
                THEN $4::VARCHAR(255)
              ELSE jname
            END,
            is_verified = is_verified OR $5
          WHERE clinic_id = $1
        `,
        [
          existingClinicId,
          record.clinic.jid,
          record.clinic.moUid,
          record.clinic.jname,
          record.clinic.isVerified,
          record.clinic.moDomen
        ]
      );

      return existingClinicId;
    }

    const effectiveMoUid = record.clinic.isVerified ? record.clinic.moUid : `ghost-${record.clinic.moDomen ?? record.clinic.moUid}`;
    const effectiveJname = record.clinic.isVerified
      ? record.clinic.jname
      : `РќРµРёР·РІРµСЃС‚РЅР°СЏ РєР»РёРЅРёРєР° (${record.clinic.moDomen ?? record.clinic.moUid})`;

    const result = await client.query<{ clinic_id: number }>(
      `
        INSERT INTO ${this.schemaName}.dim_clinics (jid, mo_uid, mo_domen, jname, is_verified)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (mo_uid) DO UPDATE
        SET
          jid = CASE WHEN EXCLUDED.jid <> 0 THEN EXCLUDED.jid ELSE ${this.schemaName}.dim_clinics.jid END,
          mo_domen = COALESCE(EXCLUDED.mo_domen, ${this.schemaName}.dim_clinics.mo_domen),
          jname = CASE
            WHEN EXCLUDED.is_verified THEN COALESCE(EXCLUDED.jname, ${this.schemaName}.dim_clinics.jname)
            ELSE COALESCE(${this.schemaName}.dim_clinics.jname, EXCLUDED.jname)
          END,
          is_verified = ${this.schemaName}.dim_clinics.is_verified OR EXCLUDED.is_verified
        RETURNING clinic_id
      `,
      [
        record.clinic.jid,
        effectiveMoUid,
        record.clinic.moDomen,
        effectiveJname,
        record.clinic.isVerified
      ]
    );

    return result.rows[0].clinic_id;
  }

  private async upsertService(client: PoolClient, record: StarSchemaLogRecord): Promise<number> {
    const result = await client.query<{ service_id: number }>(
      `
        INSERT INTO ${this.schemaName}.dim_services (kind, service_type, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (kind) DO UPDATE
        SET
          service_type = EXCLUDED.service_type,
          description = EXCLUDED.description
        RETURNING service_id
      `,
      [record.service.kind, record.service.serviceType, record.service.description]
    );

    return result.rows[0].service_id;
  }

  private async upsertFactTransaction(
    client: PoolClient,
    record: StarSchemaLogRecord,
    clinicId: number,
    serviceId: number
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO ${this.schemaName}.fact_transactions (
          clinic_id,
          service_id,
          original_log_id,
          transaction_date,
          status,
          error_category,
          error_code,
          error_message,
          error_text
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (original_log_id) DO UPDATE
        SET
          clinic_id = EXCLUDED.clinic_id,
          service_id = EXCLUDED.service_id,
          transaction_date = EXCLUDED.transaction_date,
          status = EXCLUDED.status,
          error_category = EXCLUDED.error_category,
          error_code = EXCLUDED.error_code,
          error_message = EXCLUDED.error_message,
          error_text = EXCLUDED.error_text
      `,
      [
        clinicId,
        serviceId,
        record.fact.originalLogId,
        record.fact.transactionDate,
        record.fact.status,
        record.fact.errorCategory,
        record.fact.errorCode,
        record.fact.errorMessage,
        record.fact.errorText
      ]
    );
  }

  private async upsertEgiszError(
    client: PoolClient,
    record: StarSchemaLogRecord,
    clinicId: number
  ): Promise<void> {
    if (!record.error) {
      return;
    }

    await client.query(
      `
        INSERT INTO ${this.schemaName}.egisz_errors (
          original_log_id,
          clinic_id,
          transaction_date,
          error_category,
          error_text,
          hostname
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (original_log_id) DO UPDATE
        SET
          clinic_id = EXCLUDED.clinic_id,
          transaction_date = EXCLUDED.transaction_date,
          error_category = EXCLUDED.error_category,
          error_text = EXCLUDED.error_text,
          hostname = EXCLUDED.hostname
      `,
      [
        record.error.originalLogId,
        clinicId,
        record.error.transactionDate,
        record.error.errorCategory,
        record.error.errorText,
        record.error.hostname
      ]
    );
  }

  private async migrateClinicDirectory(client: PoolClient): Promise<void> {
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_dim_clinics_mo_domen
      ON ${this.schemaName}.dim_clinics(mo_domen)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_dim_clinics_jid
      ON ${this.schemaName}.dim_clinics(jid)
    `);
    await client.query(`
      UPDATE ${this.schemaName}.dim_clinics
      SET mo_domen = lower(trim(regexp_replace(regexp_replace(mo_domen, '^[a-z][a-z0-9+.-]*://', '', 'i'), '/+$', '')))
      WHERE mo_domen IS NOT NULL
    `);
    await client.query(`
      UPDATE ${this.schemaName}.dim_clinics
      SET mo_domen = regexp_replace(mo_domen, ':\d+$', '')
      WHERE mo_domen IS NOT NULL
    `);
    await client.query(`
      UPDATE ${this.schemaName}.dim_clinics
      SET is_verified = CASE
        WHEN jname IS NOT NULL AND jname NOT LIKE 'РќРµРёР·РІРµСЃС‚РЅР°СЏ РєР»РёРЅРёРєР° (%)' THEN TRUE
        ELSE COALESCE(is_verified, FALSE)
      END
    `);

    const legacyClinicsExists = await client.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = $1
            AND table_name = 'clinics'
        ) AS exists
      `,
      [this.schemaName]
    );

    if (legacyClinicsExists.rows[0]?.exists) {
      await client.query(`
        UPDATE ${this.schemaName}.dim_clinics AS dc
        SET jname = COALESCE(dc.jname, legacy.jname)
        FROM ${this.schemaName}.clinics AS legacy
        WHERE legacy.mo_domen = dc.mo_domen
          AND legacy.jname IS NOT NULL
      `);
    }

    await client.query(`
      WITH canonical AS (
        SELECT DISTINCT ON (mo_domen)
          mo_domen,
          clinic_id
        FROM ${this.schemaName}.dim_clinics
        WHERE mo_domen IS NOT NULL
        ORDER BY mo_domen, is_verified DESC, clinic_id ASC
      )
      UPDATE ${this.schemaName}.fact_transactions AS ft
      SET clinic_id = canonical.clinic_id
      FROM ${this.schemaName}.dim_clinics AS source_clinic
      JOIN canonical
        ON canonical.mo_domen = source_clinic.mo_domen
      WHERE ft.clinic_id = source_clinic.clinic_id
        AND source_clinic.clinic_id <> canonical.clinic_id
    `);
    await client.query(`
      WITH canonical AS (
        SELECT DISTINCT ON (mo_domen)
          mo_domen,
          clinic_id
        FROM ${this.schemaName}.dim_clinics
        WHERE mo_domen IS NOT NULL
        ORDER BY mo_domen, is_verified DESC, clinic_id ASC
      )
      UPDATE ${this.schemaName}.egisz_errors AS ee
      SET clinic_id = canonical.clinic_id
      FROM ${this.schemaName}.dim_clinics AS source_clinic
      JOIN canonical
        ON canonical.mo_domen = source_clinic.mo_domen
      WHERE ee.clinic_id = source_clinic.clinic_id
        AND source_clinic.clinic_id <> canonical.clinic_id
    `);
    await client.query(`
      DELETE FROM ${this.schemaName}.dim_clinics AS duplicate_row
      USING ${this.schemaName}.dim_clinics AS kept_row
      WHERE duplicate_row.clinic_id > kept_row.clinic_id
        AND duplicate_row.mo_domen IS NOT NULL
        AND duplicate_row.mo_domen = kept_row.mo_domen
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_dim_clinics_mo_domen_unique
      ON ${this.schemaName}.dim_clinics(mo_domen)
      WHERE mo_domen IS NOT NULL
    `);
  }

  private async normalizeErrorCategories(client: PoolClient): Promise<void> {
    const networkAliases = ["network", "РЎРµС‚РµРІР°СЏ", "Р РЋР ВµРЎвЂљР ВµР Р†Р В°РЎРЏ"];
    const asyncAliases = ["async", "РђСЃРёРЅС…СЂРѕРЅРЅР°СЏ", "Р С’РЎРѓР С‘Р Р…РЎвЂ¦РЎР‚Р С•Р Р…Р Р…Р В°РЎРЏ"];

    await client.query(
      `
        UPDATE ${this.schemaName}.fact_transactions
        SET error_category = 'network'
        WHERE error_category = ANY($1::text[])
      `,
      [networkAliases]
    );
    await client.query(
      `
        UPDATE ${this.schemaName}.fact_transactions
        SET error_category = 'async'
        WHERE error_category = ANY($1::text[])
      `,
      [asyncAliases]
    );
    await client.query(
      `
        UPDATE ${this.schemaName}.egisz_errors
        SET error_category = 'network'
        WHERE error_category = ANY($1::text[])
      `,
      [networkAliases]
    );
    await client.query(
      `
        UPDATE ${this.schemaName}.egisz_errors
        SET error_category = 'async'
        WHERE error_category = ANY($1::text[])
      `,
      [asyncAliases]
    );
  }

  private async backfillEgiszErrorClinicIds(client: PoolClient): Promise<void> {
    await client.query(`
      UPDATE ${this.schemaName}.egisz_errors AS ee
      SET clinic_id = ft.clinic_id
      FROM ${this.schemaName}.fact_transactions AS ft
      WHERE ee.original_log_id = ft.original_log_id
        AND (ee.clinic_id IS NULL OR ee.clinic_id <> ft.clinic_id)
    `);
    await client.query(`
      UPDATE ${this.schemaName}.egisz_errors AS ee
      SET clinic_id = dc.clinic_id
      FROM ${this.schemaName}.dim_clinics AS dc
      WHERE ee.clinic_id IS NULL
        AND ee.hostname IS NOT NULL
        AND dc.mo_domen = ee.hostname
    `);
    await client.query(`
      WITH unresolved_clinic AS (
        INSERT INTO ${this.schemaName}.dim_clinics (jid, mo_uid, mo_domen, jname, is_verified)
        VALUES (0, 'unresolved-jid-bucket', NULL, 'Не сопоставлено (нет JID)', FALSE)
        ON CONFLICT (mo_uid) DO UPDATE
        SET jname = EXCLUDED.jname
        RETURNING clinic_id
      )
      UPDATE ${this.schemaName}.egisz_errors AS ee
      SET clinic_id = unresolved_clinic.clinic_id
      FROM unresolved_clinic
      WHERE ee.clinic_id IS NULL
    `);
  }

  private async enforceEgiszErrorClinicForeignKey(client: PoolClient): Promise<void> {
    await client.query(`
      ALTER TABLE ${this.schemaName}.egisz_errors
      DROP CONSTRAINT IF EXISTS egisz_errors_clinic_id_fkey
    `);
    await client.query(`
      ALTER TABLE ${this.schemaName}.egisz_errors
      DROP CONSTRAINT IF EXISTS fk_egisz_errors_clinic
    `);
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM ${this.schemaName}.egisz_errors
          WHERE clinic_id IS NULL
        ) THEN
          RAISE EXCEPTION 'egisz_errors contains rows without clinic_id after migration';
        END IF;
      END $$;
    `);
    await client.query(`
      ALTER TABLE ${this.schemaName}.egisz_errors
      ALTER COLUMN clinic_id SET NOT NULL
    `);
    await client.query(`
      ALTER TABLE ${this.schemaName}.egisz_errors
      ADD CONSTRAINT fk_egisz_errors_clinic
      FOREIGN KEY (clinic_id)
      REFERENCES ${this.schemaName}.dim_clinics(clinic_id)
    `);
  }

  private async createIndexes(client: PoolClient): Promise<void> {
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fact_trans_date
      ON ${this.schemaName}.fact_transactions(transaction_date)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fact_trans_agg_dashboard
      ON ${this.schemaName}.fact_transactions(clinic_id, service_id, status)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fact_trans_errors
      ON ${this.schemaName}.fact_transactions(status, error_category)
      WHERE status = 'error'
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fact_trans_clinic_id
      ON ${this.schemaName}.fact_transactions(clinic_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fact_trans_service_id
      ON ${this.schemaName}.fact_transactions(service_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fact_trans_original_log_id
      ON ${this.schemaName}.fact_transactions(original_log_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_egisz_errors_clinic_id
      ON ${this.schemaName}.egisz_errors(clinic_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_egisz_errors_hostname
      ON ${this.schemaName}.egisz_errors(hostname)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_egisz_errors_transaction_date
      ON ${this.schemaName}.egisz_errors(transaction_date)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_egisz_errors_original_log_id
      ON ${this.schemaName}.egisz_errors(original_log_id)
    `);
  }

  private async createAnalyticsViews(client: PoolClient): Promise<void> {
    await this.dropAnalyticsViews(client);

    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.view_daily_summary CASCADE`);
    await client.query(`
      CREATE OR REPLACE VIEW ${this.schemaName}.view_daily_summary AS
      SELECT
        ft.transaction_date::date AS summary_date,
        dc.mo_uid AS organization_oid,
        COALESCE(ds.description, ds.kind::text) AS semd_type,
        COUNT(*) FILTER (WHERE ft.status = 'success') AS success_count,
        COUNT(*) FILTER (WHERE ft.status = 'error') AS error_count
      FROM ${this.schemaName}.fact_transactions AS ft
      JOIN ${this.schemaName}.dim_clinics AS dc
        ON dc.clinic_id = ft.clinic_id
      JOIN ${this.schemaName}.dim_services AS ds
        ON ds.service_id = ft.service_id
      WHERE dc.mo_uid <> 'ghost-log-group-9901'
      GROUP BY
        ft.transaction_date::date,
        dc.mo_uid,
        COALESCE(ds.description, ds.kind::text)
    `);
    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.view_error_analysis CASCADE`);
    await client.query(`
      CREATE OR REPLACE VIEW ${this.schemaName}.view_error_analysis AS
      SELECT
        ft.error_category AS category,
        COUNT(*) AS occurrence_count,
        CASE
          WHEN ft.error_category = 'network' THEN 'Сетевая'
          WHEN ft.error_category = 'async' THEN 'Асинхронная'
          ELSE 'Прочая'
        END AS category_ru,
        MIN(ft.transaction_date) AS first_seen_at,
        MAX(ft.transaction_date) AS last_seen_at,
        MIN(ft.error_text) AS sample_error_text
      FROM ${this.schemaName}.fact_transactions AS ft
      JOIN ${this.schemaName}.dim_clinics AS dc
        ON dc.clinic_id = ft.clinic_id
      WHERE ft.status = 'error'
        AND dc.mo_uid <> 'ghost-log-group-9901'
        AND ft.transaction_date >= CURRENT_TIMESTAMP - INTERVAL '7 days'
      GROUP BY
        ft.error_category
    `);
    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.view_clinic_sla CASCADE`);
    await client.query(`
      CREATE OR REPLACE VIEW ${this.schemaName}.view_clinic_sla AS
      WITH clinic_last_response AS (
        SELECT
          ft.clinic_id,
          MAX(ft.transaction_date) AS last_response_at
        FROM ${this.schemaName}.fact_transactions AS ft
        GROUP BY ft.clinic_id
      )
      SELECT
        dc.clinic_id,
        dc.jid,
        dc.jname,
        dc.mo_uid AS organization_oid,
        dc.mo_domen,
        clr.last_response_at,
        CURRENT_TIMESTAMP - clr.last_response_at AS time_since_last_response,
        EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - clr.last_response_at))::bigint
          AS seconds_since_last_response,
        ROUND(
          EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - clr.last_response_at)) / 60.0,
          2
        ) AS minutes_since_last_response
      FROM ${this.schemaName}.dim_clinics AS dc
      LEFT JOIN clinic_last_response AS clr
        ON clr.clinic_id = dc.clinic_id
      WHERE dc.mo_uid <> 'ghost-log-group-9901'
    `);
      await client.query(`
        UPDATE ${this.schemaName}.dim_services
        SET kind = description
        WHERE description IS NOT NULL
          AND description <> ''
          AND description <> kind
          AND description LIKE '/%'
      `);
      await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.v_unified_analytics CASCADE`);
      const rawErrorTextSql = "COALESCE(ee.error_text, ft.error_text)";
      const normalizedErrorTextSql = this.buildNormalizedErrorTextSql(rawErrorTextSql);
      const businessErrorCategorySql = this.buildBusinessErrorCategorySql(normalizedErrorTextSql);
      await client.query(`
        CREATE OR REPLACE VIEW ${this.schemaName}.v_unified_analytics AS
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
        COALESCE(
          NULLIF(TRIM(dc.jname), ''),
          CASE
            WHEN dc.jid IS NOT NULL AND dc.jid <> 0 THEN 'Клиника JID: ' || dc.jid::TEXT
            ELSE NULL
          END,
          NULLIF(TRIM(ee.hostname), ''),
          'Неизвестная клиника'
        ) AS clinic_display_name,
        dc.mo_uid,
        dc.mo_domen,
        ft.service_id,
        ds.kind AS service_kind,
        ds.kind AS document_type,
        ds.service_type,
        ds.description AS service_description,
        ${this.buildSemdNameSql("ds.kind")} AS service_kind_name,
        COALESCE(${this.buildSemdNameSql("ds.kind")}, ds.description, ds.kind) AS document_name,
        COALESCE(${this.buildSemdNameSql("ds.kind")}, ds.description, ds.service_type, ds.kind) AS service_display_name,
        CASE
          WHEN ft.status <> 'error' THEN NULL
          ELSE ${businessErrorCategorySql}
        END AS error_category,
        ft.error_category AS transport_error_category,
        CASE
          WHEN ft.status <> 'error' THEN NULL
          WHEN ee.hostname ~* 'gost-\\d+\\.infoclinica\\.lan' THEN 'clinic_hostname'
          WHEN ${rawErrorTextSql} ~* 'auth|authentication|авторизац|логин|парол|token|401|403'
            THEN 'auth'
          WHEN ${rawErrorTextSql} ~* 'timeout|timed out|таймаут'
            THEN 'timeout'
          WHEN ${rawErrorTextSql} ~* 'connection refused|connect failed|could not connect|соединени'
            THEN 'connection_refused'
          WHEN ${rawErrorTextSql} ~* 'proxy'
            THEN 'proxy'
          WHEN ${rawErrorTextSql} ~* 'egisz|егисз'
            THEN 'egisz'
          WHEN ${rawErrorTextSql} ~* 'validation|invalid|некоррект|ошибка форма'
            THEN 'validation'
          ELSE 'unknown'
        END AS error_subcategory,
        convert_from(convert_to(${rawErrorTextSql}, 'UTF8'), 'UTF8') AS error_text,
        ${normalizedErrorTextSql} AS clean_error_text,
        ${normalizedErrorTextSql} AS normalized_error_text,
        md5(
          COALESCE(
            CASE
              WHEN ft.status <> 'error' THEN NULL
              ELSE ${businessErrorCategorySql}
            END,
            ''
          ) || '|' ||
          COALESCE(
            ${normalizedErrorTextSql},
            ''
          )
        ) AS error_fingerprint,
        ee.hostname,
        (ee.error_id IS NOT NULL) AS has_egisz_error_record,
        COALESCE(dec.base_cost_per_error, 0.00) AS error_base_cost,
        COALESCE(dec.escalation_multiplier, 1.00) AS error_escalation_multiplier,
        CASE
          WHEN ft.status = 'error' THEN COALESCE(dec.base_cost_per_error * dec.escalation_multiplier, 0.00)
          ELSE 0.00
        END AS error_cost
      FROM ${this.schemaName}.fact_transactions AS ft
      JOIN ${this.schemaName}.dim_clinics AS dc
        ON dc.clinic_id = ft.clinic_id
      JOIN ${this.schemaName}.dim_services AS ds
        ON ds.service_id = ft.service_id
      LEFT JOIN ${this.schemaName}.egisz_errors AS ee
        ON ee.original_log_id = ft.original_log_id
      LEFT JOIN ${this.schemaName}.dim_error_costs AS dec
        ON dec.error_category = COALESCE(
          CASE
            WHEN ft.status <> 'error' THEN NULL
            WHEN ${rawErrorTextSql} ~* 'auth|authentication|авторизац|логин|парол|token|401|403'
              THEN 'other'
            WHEN ${rawErrorTextSql} ~* 'timeout|timed out|таймаут'
              THEN 'other'
            WHEN ${rawErrorTextSql} ~* 'connection refused|connect failed|could not connect|соединени'
              THEN 'other'
            WHEN ${rawErrorTextSql} ~* 'proxy'
              THEN 'other'
            WHEN ${rawErrorTextSql} ~* 'egisz|егисз'
              THEN 'other'
            WHEN ${rawErrorTextSql} ~* 'validation|invalid|некоррект|ошибка форма'
              THEN 'other'
            ELSE ft.error_category
          END,
          'other'
        ) AND dec.error_subcategory = CASE
          WHEN ft.status <> 'error' THEN NULL
          WHEN ${rawErrorTextSql} ~* 'auth|authentication|авторизац|логин|парол|token|401|403'
            THEN 'auth'
          WHEN ${rawErrorTextSql} ~* 'timeout|timed out|таймаут'
            THEN 'timeout'
          WHEN ${rawErrorTextSql} ~* 'connection refused|connect failed|could not connect|соединени'
            THEN 'connection_refused'
          WHEN ${rawErrorTextSql} ~* 'proxy'
            THEN 'proxy'
          WHEN ${rawErrorTextSql} ~* 'egisz|егисз'
            THEN 'egisz'
          WHEN ${rawErrorTextSql} ~* 'validation|invalid|некоррект|ошибка форма'
            THEN 'validation'
          ELSE 'unknown'
        END
      WHERE dc.mo_uid <> 'ghost-log-group-9901'
    `);
    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.v_error_fingerprints CASCADE`);
    await client.query(`
      CREATE OR REPLACE VIEW ${this.schemaName}.v_error_fingerprints AS
      SELECT
        ua.error_fingerprint,
        ua.error_category,
        ua.error_subcategory,
        MIN(ua.transaction_date) AS first_seen_at,
        MAX(ua.transaction_date) AS last_seen_at,
        COUNT(*) AS total_occurrences,
        COUNT(DISTINCT ua.clinic_id) AS affected_clinics,
        COUNT(DISTINCT ua.hostname) FILTER (WHERE ua.hostname IS NOT NULL) AS affected_hosts,
        MIN(ua.error_text) AS sample_error_text
      FROM ${this.schemaName}.v_unified_analytics AS ua
      WHERE ua.is_error
      GROUP BY
        ua.error_fingerprint,
        ua.error_category,
        ua.error_subcategory
    `);
    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.v_clinic_hourly_sla CASCADE`);
    await client.query(`
      CREATE OR REPLACE VIEW ${this.schemaName}.v_clinic_hourly_sla AS
      SELECT
        ua.date_hour,
        ua.clinic_id,
        ua.jid,
        ua.jname,
        ua.clinic_display_name,
        ua.mo_uid,
        COUNT(*) AS total_requests,
        COUNT(*) FILTER (WHERE ua.is_success) AS successful_requests,
        COUNT(*) FILTER (WHERE ua.is_error) AS failed_requests,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE ua.is_success) / NULLIF(COUNT(*) FILTER (WHERE ua.transaction_id IS NOT NULL), 0),
          2
        ) AS sla_success_pct
      FROM ${this.schemaName}.v_unified_analytics AS ua
      GROUP BY
        ua.date_hour,
        ua.clinic_id,
        ua.jid,
        ua.jname,
        ua.clinic_display_name,
        ua.mo_uid
    `);
    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.v_clinic_performance CASCADE`);
    await client.query(`
      CREATE OR REPLACE VIEW ${this.schemaName}.v_clinic_performance AS
      SELECT
        ua.date_day,
        ua.clinic_id,
        ua.jid,
        ua.jname,
        ua.clinic_display_name,
        ua.mo_uid,
        ua.document_type,
        ua.document_name,
        COUNT(*) AS total_requests,
        COUNT(*) FILTER (WHERE ua.is_success) AS successful_requests,
        COUNT(*) FILTER (WHERE ua.is_error) AS failed_requests,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE ua.is_success) / NULLIF(COUNT(*), 0),
          2
        ) AS success_rate_pct
      FROM ${this.schemaName}.v_unified_analytics AS ua
      GROUP BY
        ua.date_day,
        ua.clinic_id,
        ua.jid,
        ua.jname,
        ua.clinic_display_name,
        ua.mo_uid,
        ua.document_type,
        ua.document_name
    `);
    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.v_service_hourly_health CASCADE`);
    await client.query(`
      CREATE OR REPLACE VIEW ${this.schemaName}.v_service_hourly_health AS
      SELECT
        ua.date_hour,
        ua.service_id,
        ua.service_kind,
        ua.service_type,
        ua.service_display_name,
        COUNT(*) AS total_requests,
        COUNT(*) FILTER (WHERE ua.is_success) AS successful_requests,
        COUNT(*) FILTER (WHERE ua.is_error) AS failed_requests,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE ua.is_success) / NULLIF(COUNT(*), 0),
          2
        ) AS success_rate_pct
      FROM ${this.schemaName}.v_unified_analytics AS ua
      GROUP BY
        ua.date_hour,
        ua.service_id,
        ua.service_kind,
        ua.service_type,
        ua.service_display_name
    `);

    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.v_support_economic_metrics CASCADE`);
    await client.query(`
      CREATE OR REPLACE VIEW ${this.schemaName}.v_support_economic_metrics AS
      SELECT
        ua.date_day,
        ua.clinic_id,
        ua.jid,
        ua.jname,
        ua.clinic_display_name,
        ua.mo_uid,
        ua.mo_domen,
        COUNT(*) AS total_requests,
        COUNT(*) FILTER (WHERE ua.is_error) AS error_count,
        SUM(ua.error_cost) AS total_error_cost,
        ROUND(AVG(ua.error_cost) FILTER (WHERE ua.is_error), 2) AS avg_error_cost,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE ua.is_error) / NULLIF(COUNT(*), 0),
          2
        ) AS error_rate_pct,
        MAX(ua.transaction_date) AS last_transaction_at,
        CASE
          WHEN COUNT(*) FILTER (WHERE ua.is_error) > 10 THEN 'high'
          WHEN COUNT(*) FILTER (WHERE ua.is_error) > 5 THEN 'medium'
          ELSE 'low'
        END AS support_priority
      FROM ${this.schemaName}.v_unified_analytics AS ua
      WHERE ua.transaction_date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY
        ua.date_day,
        ua.clinic_id,
        ua.jid,
        ua.jname,
        ua.clinic_display_name,
        ua.mo_uid,
        ua.mo_domen
    `);

    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.v_vpn_node_stability CASCADE`);
    await client.query(`
      CREATE OR REPLACE VIEW ${this.schemaName}.v_vpn_node_stability AS
      WITH hourly_stats AS (
        SELECT
          ua.hostname,
          date_trunc('hour', ua.transaction_date) AS date_hour,
          COUNT(*) AS total_requests,
          COUNT(*) FILTER (WHERE ua.is_success) AS successful_requests,
          COUNT(*) FILTER (WHERE ua.is_error) AS failed_requests,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE ua.is_success) / NULLIF(COUNT(*), 0),
            2
          ) AS success_rate_pct
        FROM ${this.schemaName}.v_unified_analytics AS ua
        WHERE ua.hostname IS NOT NULL
          AND ua.transaction_date >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
        GROUP BY ua.hostname, date_trunc('hour', ua.transaction_date)
      )
      SELECT
        hostname,
        date_hour,
        total_requests,
        successful_requests,
        failed_requests,
        success_rate_pct,
        0 AS avg_response_time_seconds,
        CASE
          WHEN success_rate_pct < 90 THEN 'critical'
          WHEN success_rate_pct < 95 THEN 'warning'
          ELSE 'stable'
        END AS stability_status,
        'normal' AS performance_status
      FROM hourly_stats
      ORDER BY hostname, date_hour DESC
    `);
  }

  private async dropAnalyticsViews(client: PoolClient): Promise<void> {
    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.v_unified_analytics CASCADE`);
    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.v_support_economic_metrics CASCADE`);
    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.v_vpn_node_stability CASCADE`);
    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.v_clinic_performance CASCADE`);
    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.v_error_fingerprints CASCADE`);
    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.v_clinic_hourly_sla CASCADE`);
    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.v_service_hourly_health CASCADE`);
    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.view_clinic_sla CASCADE`);
    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.view_error_analysis CASCADE`);
    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.view_daily_summary CASCADE`);
  }

  private validateSchemaName(value: string): string {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
      throw new Error("POSTGRES_SCHEMA must be a valid SQL identifier");
    }

    return value;
  }

  private async findClinicIdByDomain(client: PoolClient, hostname: string): Promise<number | null> {
    const result = await client.query<{ clinic_id: number }>(
      `
        SELECT clinic_id
        FROM ${this.schemaName}.dim_clinics
        WHERE mo_domen = $1
        ORDER BY is_verified DESC, clinic_id ASC
        LIMIT 1
      `,
      [hostname]
    );

    return result.rows[0]?.clinic_id ?? null;
  }

  private async findClinicIdByJid(client: PoolClient, jid: number): Promise<number | null> {
    const result = await client.query<{ clinic_id: number }>(
      `
        SELECT clinic_id
        FROM ${this.schemaName}.dim_clinics
        WHERE jid = $1
        ORDER BY is_verified DESC, clinic_id ASC
        LIMIT 1
      `,
      [jid]
    );

    return result.rows[0]?.clinic_id ?? null;
  }

  private async rollbackQuietly(client: PoolClient): Promise<void> {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback errors so we can surface the original failure.
    }
  }

  private normalizeStoredFirebirdConnection(config: StoredFirebirdConfig): FirebirdConnectionConfig {
    const defaultJoinQuery = process.env.FIREBIRD_JOIN_QUERY ?? buildDefaultFirebirdJoinQuery();
    const rawJoinQuery = this.readString(config.joinQuery, defaultJoinQuery);

    return {
      host: this.readString(config.host, DEFAULT_FIREBIRD_CONNECTION.host),
      port: this.readNumber(config.port, DEFAULT_FIREBIRD_CONNECTION.port),
      alias: this.readString(config.alias ?? config.path, DEFAULT_FIREBIRD_CONNECTION.alias),
      user: this.readString(config.user, DEFAULT_FIREBIRD_CONNECTION.user),
      password: this.readString(config.password ?? config.pass, DEFAULT_FIREBIRD_CONNECTION.pass),
      pageSize: this.readNumber(config.pageSize, Number(process.env.FIREBIRD_PAGE_SIZE ?? "4096")),
      joinQuery: this.normalizeJoinQuery(rawJoinQuery)
    };
  }

  private normalizeStoredFirebirdConfigView(config: StoredFirebirdConfig): FirebirdConfigResponse {
    return {
      host: this.readString(config.host, DEFAULT_FIREBIRD_CONNECTION.host),
      port: this.readNumber(config.port, DEFAULT_FIREBIRD_CONNECTION.port),
      alias: this.readString(config.alias ?? config.path, DEFAULT_FIREBIRD_CONNECTION.alias),
      user: this.readString(config.user, DEFAULT_FIREBIRD_CONNECTION.user),
      pass: this.readString(config.password ?? config.pass, DEFAULT_FIREBIRD_CONNECTION.pass),
      isDefault: this.readBoolean(config.isDefault, false)
    };
  }

  private readString(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
  }

  private readNumber(value: unknown, fallback: number): number {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private readBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
  }

  private normalizeJoinQuery(query: string): string {
    // Self-heal legacy persisted queries that reference non-existent Firebird columns.
    const normalized = query
      .replace(/\bl\.LID\b/gi, "l.ID")
      .replace(/\bj\.MO_UID\b/gi, "l.MO_UID");

    const hasInvalidLegacyColumns = /\be\.JID\b|\be\.KIND\b|\bm\.MSGTEXT\b/i.test(normalized);

    if (hasInvalidLegacyColumns) {
      console.warn("[Firebird] Detected legacy join query with non-existent columns. Falling back to default query.");
      return buildDefaultFirebirdJoinQuery();
    }

    return normalized;
  }

  private toDatabaseError(error: unknown, prefix: string): Error {
    const originalMessage = error instanceof Error ? error.message : "Unknown PostgreSQL error";
    const issue = this.inspectConnectionIssue(error);
    const hint = issue.userHint ? ` ${issue.userHint}` : "";

    return new Error(
      `${prefix} for ${this.config.host}:${this.config.port}/${this.config.database}. ${originalMessage}${hint}`
    );
  }
}
