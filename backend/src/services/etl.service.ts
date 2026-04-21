import { parseStringPromise } from "xml2js";

import { EtlRunResult, FirebirdLicenseLogRow, StarSchemaLogRecord } from "../types";
import { FirebirdService } from "./firebird.service";
import { PostgresService } from "./postgres.service";

const NETWORK_ERROR_CATEGORY = "Сетевая";
const ASYNC_ERROR_CATEGORY = "Асинхронная";

export class EtlService {
  constructor(
    private readonly firebirdService: FirebirdService,
    private readonly postgresService: PostgresService,
    private readonly batchSize: number
  ) {}

  async run(): Promise<EtlRunResult> {
    return this.postgresService.withEtlLock(async () => {
      const sourceRows = await this.firebirdService.fetchLicenseExchangeLogs();
      const transformed: StarSchemaLogRecord[] = [];

      for (const row of sourceRows) {
        const normalized = await this.normalizeRow(row);

        if (normalized) {
          transformed.push(normalized);
        }
      }

      await this.postgresService.ensureSchema();

      let inserted = 0;

      for (let index = 0; index < transformed.length; index += this.batchSize) {
        const batch = transformed.slice(index, index + this.batchSize);
        inserted += await this.postgresService.upsertStarSchemaBatch(batch);
      }

      return {
        extracted: sourceRows.length,
        transformed: transformed.length,
        inserted,
        skipped: sourceRows.length - transformed.length
      };
    });
  }

  private async normalizeRow(row: FirebirdLicenseLogRow): Promise<StarSchemaLogRecord | null> {
    const originalLogId = this.toRequiredNumber(row.EXCHANGELOG_ID ?? row.LOGID, "EXCHANGELOG_ID");
    const logText = this.toOptionalString(row.LOGTEXT);
    const uri = this.toOptionalString(row.URI);
    const method = this.toOptionalString(row.METHOD);
    const action = this.toOptionalString(row.ACTION);
    const domain = this.toOptionalString(row.MO_DOMEN) ?? this.extractDomain(logText);
    const jid =
      this.toOptionalNumber(row.JID) ??
      this.extractJid(domain) ??
      this.extractJid(logText) ??
      this.toOptionalNumber(row.GRPID) ??
      0;
    const moUid = this.toOptionalString(row.MO_UID) ?? domain ?? `log-group-${this.toOptionalNumber(row.GRPID) ?? originalLogId}`;
    const serviceDescription = this.buildServiceDescription(uri, method, action, row);
    const kind = this.toOptionalNumber(row.KIND) ?? this.toStablePositiveNumber(serviceDescription);
    const serviceType = this.toOptionalNumber(row.SERVICE_TYPE) ?? this.toOptionalNumber(row.LOGTYPE) ?? kind;
    const transactionDate =
      this.toOptionalDate(row.MODIFYDATE) ??
      this.toOptionalDate(row.LOG_CREATED_AT) ??
      this.toOptionalDate(row.LOGDATE) ??
      this.toOptionalDate(row.LICENSE_CREATED_AT);

    if (!transactionDate) {
      throw new Error(`Source row ${originalLogId} is missing MODIFYDATE and fallback log dates`);
    }

    const logState = this.toOptionalNumber(row.LOGSTATE);
    const asyncError = await this.parseAsyncError(this.toOptionalString(row.MSGTEXT));
    const hasNetworkError = logState === 3;
    const hasAsyncError = Boolean(asyncError);
    const status = hasNetworkError || hasAsyncError ? "error" : "success";
    const errorCategory = hasNetworkError
      ? NETWORK_ERROR_CATEGORY
      : hasAsyncError
        ? ASYNC_ERROR_CATEGORY
        : null;
    const errorText = hasNetworkError ? logText : asyncError;

    return {
      clinic: {
        jid,
        moUid,
        moDomen: domain
      },
      service: {
        kind,
        serviceType,
        description: serviceDescription
      },
      fact: {
        originalLogId,
        transactionDate,
        status,
        errorCategory,
        errorText
      }
    };
  }

  private async parseAsyncError(messageText: string | null): Promise<string | null> {
    if (!messageText || !messageText.includes("<")) {
      return null;
    }

    try {
      const parsed = await parseStringPromise(messageText, {
        explicitArray: false,
        trim: true,
        tagNameProcessors: [
          (name) => {
            const normalized = String(name);
            const separatorIndex = normalized.indexOf(":");
            return separatorIndex >= 0 ? normalized.slice(separatorIndex + 1).toLowerCase() : normalized.toLowerCase();
          }
        ]
      });

      const status = this.findFirstValueByTagName(parsed, "status")?.toLowerCase();

      if (status !== "error") {
        return null;
      }

      return this.findFirstValueByTagName(parsed, "message");
    } catch {
      return null;
    }
  }

  private findFirstValueByTagName(node: unknown, tagName: string): string | null {
    if (node === null || node === undefined) {
      return null;
    }

    if (typeof node === "string") {
      return null;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        const found = this.findFirstValueByTagName(item, tagName);

        if (found) {
          return found;
        }
      }

      return null;
    }

    if (typeof node === "object") {
      const objectNode = node as Record<string, unknown>;

      if (tagName in objectNode) {
        const value = objectNode[tagName];

        if (typeof value === "string") {
          return value;
        }

        if (Array.isArray(value) && typeof value[0] === "string") {
          return value[0];
        }
      }

      for (const value of Object.values(objectNode)) {
        const found = this.findFirstValueByTagName(value, tagName);

        if (found) {
          return found;
        }
      }
    }

    return null;
  }

  private toOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : null;
  }

  private toRequiredString(value: unknown, fieldName: string): string {
    const normalized = this.toOptionalString(value);

    if (!normalized) {
      throw new Error(`Source row is missing required field ${fieldName}`);
    }

    return normalized;
  }

  private toOptionalNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const normalized = Number(value);
    return Number.isNaN(normalized) ? null : normalized;
  }

  private toRequiredNumber(value: unknown, fieldName: string): number {
    const normalized = this.toOptionalNumber(value);

    if (normalized === null) {
      throw new Error(`Source row is missing required numeric field ${fieldName}`);
    }

    return normalized;
  }

  private toOptionalDate(value: unknown): Date | null {
    if (!value) {
      return null;
    }

    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private extractDomain(value: string | null): string | null {
    if (!value) {
      return null;
    }

    try {
      return new URL(value).origin;
    } catch {
      return null;
    }
  }

  private extractJid(value: string | null): number | null {
    if (!value) {
      return null;
    }

    const match = value.match(/(?:gost-)(\d+)/i);
    return match ? Number(match[1]) : null;
  }

  private buildServiceDescription(
    uri: string | null,
    method: string | null,
    action: string | null,
    row: FirebirdLicenseLogRow
  ): string {
    const candidates = [
      uri,
      action,
      method ? `${method} ${uri ?? action ?? ""}`.trim() : null,
      this.toOptionalNumber(row.LOGTYPE) !== null ? `LOGTYPE:${this.toOptionalNumber(row.LOGTYPE)}` : null
    ];

    for (const candidate of candidates) {
      if (candidate && candidate.length > 0) {
        return candidate;
      }
    }

    return "unknown-service";
  }

  private toStablePositiveNumber(value: string): number {
    let hash = 0;

    for (let index = 0; index < value.length; index += 1) {
      hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
    }

    return hash === 0 ? 1 : hash;
  }
}
