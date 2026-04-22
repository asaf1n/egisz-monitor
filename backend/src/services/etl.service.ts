import { parseStringPromise } from "xml2js";

import { EgiszErrorRecord, EtlRunResult, EtlRunStatus, FirebirdLicenseLogRow, StarSchemaLogRecord } from "../types";
import { FirebirdService } from "./firebird.service";
import { PostgresService } from "./postgres.service";

const NETWORK_ERROR_CATEGORY = "network";
const ASYNC_ERROR_CATEGORY = "async";
const HOSTNAME_TAG_CANDIDATES = ["replyto", "hostname", "host", "address", "url", "endpoint"] as const;
const EXCLUDED_HOSTNAME_FRAGMENTS = [
  "egisz",
  "proxy",
  "host.docker.internal",
  "localhost"
] as const;

type ParsedMessageMetadata = {
  errorText: string | null;
  hostname: string | null;
};

export class EtlService {
  private currentRun: Promise<void> | null = null;
  private currentStatus: EtlRunStatus = {
    status: "idle",
    stage: "idle",
    message: "ETL is idle",
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null
  };

  constructor(
    private readonly firebirdService: FirebirdService,
    private readonly postgresService: PostgresService,
    private readonly batchSize: number
  ) {}

  start(): EtlRunStatus {
    if (this.currentRun) {
      return this.getStatus();
    }

    const startedAt = new Date().toISOString();
    this.currentStatus = {
      status: "running",
      stage: "extracting",
      message: "Extracting exchange logs from Firebird",
      startedAt,
      finishedAt: null,
      result: null,
      error: null
    };

    this.currentRun = this.runInternal()
      .then((result) => {
        const finishedAt = new Date().toISOString();
        this.currentStatus = {
          status: "success",
          stage: "success",
          message: `ETL completed: inserted ${result.inserted} rows from ${result.extracted}`,
          startedAt,
          finishedAt,
          result,
          error: null
        };
      })
      .catch((error: unknown) => {
        const finishedAt = new Date().toISOString();
        const message = error instanceof Error ? error.message : "Unknown ETL error";
        this.currentStatus = {
          status: "failed",
          stage: "failed",
          message,
          startedAt,
          finishedAt,
          result: null,
          error: message
        };
        console.error(`ETL run failed at ${finishedAt}`, error);
      })
      .finally(() => {
        this.currentRun = null;
      });

    return this.getStatus();
  }

  getStatus(): EtlRunStatus {
    return { ...this.currentStatus };
  }

  async run(): Promise<EtlRunResult> {
    return this.runInternal();
  }

  canonicalizeHostname(raw: string): string {
    const normalized = this.normalizeHostname(raw);
    return normalized ?? "";
  }

  private async runInternal(): Promise<EtlRunResult> {
    return this.postgresService.withEtlLock(async () => {
      const startedAt = new Date().toISOString();
      console.log(`ETL run started at ${startedAt}`);
      this.updateStatus("extracting", "Extracting exchange logs from Firebird");

      const sourceRows = await this.firebirdService.fetchLicenseExchangeLogs();
      const transformed: StarSchemaLogRecord[] = [];
      this.updateStatus("parsing", `Parsing ${sourceRows.length} Firebird rows`);

      for (let index = 0; index < sourceRows.length; index += 1) {
        const row = sourceRows[index];
        const normalized = await this.normalizeRow(row);

        if (normalized) {
          transformed.push(normalized);
        }

        if ((index + 1) % 100 === 0 || index === sourceRows.length - 1) {
          this.updateStatus("parsing", `Parsed ${index + 1} of ${sourceRows.length} Firebird rows`);
        }
      }

      await this.postgresService.ensureSchema();
      this.updateStatus("loading", `Loading ${transformed.length} normalized rows into PostgreSQL`);

      let inserted = 0;

      for (let index = 0; index < transformed.length; index += this.batchSize) {
        const batch = transformed.slice(index, index + this.batchSize);
        inserted += await this.postgresService.upsertStarSchemaBatch(batch);
        this.updateStatus(
          "loading",
          `Loaded ${Math.min(index + batch.length, transformed.length)} of ${transformed.length} normalized rows`
        );
      }

      const result = {
        extracted: sourceRows.length,
        transformed: transformed.length,
        inserted,
        skipped: sourceRows.length - transformed.length
      };

      console.log(`ETL run completed at ${new Date().toISOString()}. Inserted ${result.inserted} rows from ${result.extracted}.`);

      return result;
    });
  }

  private async normalizeRow(row: FirebirdLicenseLogRow): Promise<StarSchemaLogRecord | null> {
    const originalLogId = this.toRequiredNumber(row.EXCHANGELOG_ID ?? row.LOGID, "EXCHANGELOG_ID");
    const logText = this.normalizeText(this.toOptionalString(row.LOGTEXT));
    const messageText = this.normalizeText(this.toOptionalString(row.MSGTEXT));
    const uri = this.normalizeText(this.toOptionalString(row.URI));
    const method = this.normalizeText(this.toOptionalString(row.METHOD));
    const action = this.normalizeText(this.toOptionalString(row.ACTION));
    const explicitDomain = this.normalizeClinicHostname(this.normalizeText(this.toOptionalString(row.MO_DOMEN)));
    const parsedMessage = await this.parseMessageMetadata(messageText);
    const hostnameCandidates = this.collectHostnameCandidates(
      this.normalizeText(this.toOptionalString(row.REPLYTO)),
      parsedMessage.hostname,
      logText,
      messageText
    );
    const hostname = this.findTargetClinicHostname(hostnameCandidates);
    const clinicDomain = explicitDomain ?? hostname;
    const jid =
      this.toOptionalNumber(row.JID) ??
      this.extractJid(clinicDomain) ??
      this.extractJid(logText) ??
      this.extractJid(messageText) ??
      this.toOptionalNumber(row.GRPID) ??
      0;
    const moUid =
      this.normalizeText(this.toOptionalString(row.MO_UID)) ??
      clinicDomain ??
      `log-group-${this.toOptionalNumber(row.GRPID) ?? originalLogId}`;
    const jname = this.normalizeText(this.toOptionalString(row.JNAME));
    const serviceDescription = this.buildServiceDescription(uri, method, action, row);
    const kind = this.normalizeCodeValue(row.KIND) ?? serviceDescription;
    const serviceType = this.normalizeCodeValue(row.SERVICE_TYPE) ?? this.normalizeCodeValue(row.LOGTYPE) ?? kind;
    const transactionDate =
      this.toOptionalDate(row.MODIFYDATE) ??
      this.toOptionalDate(row.LOG_CREATED_AT) ??
      this.toOptionalDate(row.LOGDATE) ??
      this.toOptionalDate(row.LICENSE_CREATED_AT);

    if (!transactionDate) {
      throw new Error(`Source row ${originalLogId} is missing MODIFYDATE and fallback log dates`);
    }

    const logState = this.toOptionalNumber(row.LOGSTATE);
    const asyncError = parsedMessage.errorText;
    const hasNetworkError = logState === 3;
    const hasAsyncError = Boolean(asyncError);
    const status = hasNetworkError || hasAsyncError ? "error" : "success";
    const errorCategory = hasNetworkError
      ? NETWORK_ERROR_CATEGORY
      : hasAsyncError
        ? ASYNC_ERROR_CATEGORY
        : null;
    const errorText = this.normalizeText(hasNetworkError ? logText : asyncError);

    return {
      clinic: {
        jid,
        moUid,
        moDomen: clinicDomain,
        jname,
        isVerified: Boolean(explicitDomain || jname)
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
      },
      error: status === "error" && errorCategory && errorText
        ? this.buildErrorRecord({
            originalLogId,
            transactionDate,
            errorCategory,
            errorText,
            hostname
          })
        : null
    };
  }

  private buildErrorRecord(record: EgiszErrorRecord): EgiszErrorRecord {
    return record;
  }

  private async parseMessageMetadata(messageText: string | null): Promise<ParsedMessageMetadata> {
    if (!messageText || !messageText.includes("<")) {
      return {
        errorText: null,
        hostname: null
      };
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
      const hostnameCandidate = this.findFirstMatchingTagValue(parsed, HOSTNAME_TAG_CANDIDATES);
      const hostname = this.findTargetClinicHostname(hostnameCandidate ? [hostnameCandidate] : []);

      if (status !== "error") {
        return {
          errorText: null,
          hostname
        };
      }

      return {
        errorText: this.normalizeText(this.findFirstValueByTagName(parsed, "message")),
        hostname
      };
    } catch {
      return {
        errorText: null,
        hostname: null
      };
    }
  }

  private findFirstMatchingTagValue(node: unknown, tagNames: readonly string[]): string | null {
    for (const tagName of tagNames) {
      const value = this.findFirstValueByTagName(node, tagName);

      if (value) {
        return value;
      }
    }

    return null;
  }

  private findFirstValueByTagName(node: unknown, tagName: string): string | null {
    if (node === null || node === undefined || typeof node === "string") {
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

    return null;
  }

  private toOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : null;
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

  private normalizeText(value: string | null): string | null {
    if (!value) {
      return null;
    }

    const trimmed = value.trim();
    const repaired = this.repairMojibake(trimmed);
    return repaired.length > 0 ? repaired : null;
  }

  private repairMojibake(value: string): string {
    if (!this.looksLikeMojibake(value)) {
      return value;
    }

    const bytes: number[] = [];

    for (const char of value) {
      const encoded = this.encodeCp1251Char(char);

      if (encoded === null) {
        return value;
      }

      bytes.push(encoded);
    }

    const decoded = Buffer.from(bytes).toString("utf8").trim();
    return this.looksLikeDecodedRussian(decoded) ? decoded : value;
  }

  private looksLikeMojibake(value: string): boolean {
    return /(?:Р.|С.|Ð.|Ñ.){2,}/u.test(value);
  }

  private looksLikeDecodedRussian(value: string): boolean {
    return /[А-Яа-яЁё]/u.test(value) && !/(?:Р.|С.|Ð.|Ñ.){2,}/u.test(value);
  }

  private encodeCp1251Char(char: string): number | null {
    const codePoint = char.codePointAt(0);

    if (codePoint === undefined) {
      return null;
    }

    if (codePoint <= 0x7f) {
      return codePoint;
    }

    if (codePoint >= 0x0410 && codePoint <= 0x044f) {
      return codePoint - 0x0350;
    }

    const specialMap = new Map<number, number>([
      [0x0401, 0xa8],
      [0x0451, 0xb8],
      [0x0402, 0x80],
      [0x0403, 0x81],
      [0x201a, 0x82],
      [0x0453, 0x83],
      [0x201e, 0x84],
      [0x2026, 0x85],
      [0x2020, 0x86],
      [0x2021, 0x87],
      [0x20ac, 0x88],
      [0x2030, 0x89],
      [0x0409, 0x8a],
      [0x2039, 0x8b],
      [0x040a, 0x8c],
      [0x040c, 0x8d],
      [0x040b, 0x8e],
      [0x040f, 0x8f],
      [0x0452, 0x90],
      [0x2018, 0x91],
      [0x2019, 0x92],
      [0x201c, 0x93],
      [0x201d, 0x94],
      [0x2022, 0x95],
      [0x2013, 0x96],
      [0x2014, 0x97],
      [0x2122, 0x99],
      [0x0459, 0x9a],
      [0x203a, 0x9b],
      [0x045a, 0x9c],
      [0x045c, 0x9d],
      [0x045b, 0x9e],
      [0x045f, 0x9f],
      [0x00a0, 0xa0],
      [0x040e, 0xa1],
      [0x045e, 0xa2],
      [0x0408, 0xa3],
      [0x00a4, 0xa4],
      [0x0490, 0xa5],
      [0x00a6, 0xa6],
      [0x00a7, 0xa7],
      [0x00a9, 0xa9],
      [0x0404, 0xaa],
      [0x00ab, 0xab],
      [0x00ac, 0xac],
      [0x00ad, 0xad],
      [0x00ae, 0xae],
      [0x0407, 0xaf],
      [0x00b0, 0xb0],
      [0x00b1, 0xb1],
      [0x0406, 0xb2],
      [0x0456, 0xb3],
      [0x0491, 0xb4],
      [0x00b5, 0xb5],
      [0x00b6, 0xb6],
      [0x00b7, 0xb7],
      [0x2116, 0xb9],
      [0x0454, 0xba],
      [0x00bb, 0xbb],
      [0x0458, 0xbc],
      [0x0405, 0xbd],
      [0x0455, 0xbe],
      [0x0457, 0xbf]
    ]);

    return specialMap.get(codePoint) ?? null;
  }

  private collectHostnameCandidates(...sources: Array<string | null>): string[] {
    const candidates: string[] = [];

    for (const source of sources) {
      if (!source) {
        continue;
      }

      candidates.push(source);
      candidates.push(this.extractReplyToHeader(source) ?? "");
      candidates.push(...this.extractHostnamesFromText(source));
    }

    return candidates.filter((candidate) => candidate.length > 0);
  }

  private findTargetClinicHostname(candidates: string[]): string | null {
    for (const candidate of candidates) {
      const normalized = this.normalizeHostname(candidate);

      if (normalized && this.isTargetClinicHostname(normalized)) {
        return normalized;
      }
    }

    return null;
  }

  private normalizeClinicHostname(value: string | null): string | null {
    const normalized = this.normalizeHostname(value);
    return normalized && this.isTargetClinicHostname(normalized) ? normalized : null;
  }

  private normalizeHostname(value: string | null): string | null {
    if (!value) {
      return null;
    }

    const trimmed = value.trim();

    if (trimmed.length === 0) {
      return null;
    }

    const withoutProtocol = trimmed
      .replace(/^["'<(\[]+|[>"')\]]+$/g, "")
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
      .replace(/^\/\//, "");
    const hostWithOptionalPort = withoutProtocol
      .split(/[/?#\s;,]/, 1)[0]
      ?.trim()
      .replace(/\/+$/, "") ?? "";
    const normalized = hostWithOptionalPort.replace(/:\d+$/, "").replace(/\.$/, "").toLowerCase();

    return normalized.length > 0 ? normalized : null;
  }

  private isTargetClinicHostname(hostname: string): boolean {
    if (!this.isFqdn(hostname)) {
      return false;
    }

    if (EXCLUDED_HOSTNAME_FRAGMENTS.some((fragment) => hostname.includes(fragment))) {
      return false;
    }

    return this.extractJid(hostname) !== null;
  }

  private isFqdn(value: string): boolean {
    if (!value.includes(".") || value.length > 253) {
      return false;
    }

    const labels = value.split(".");

    return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
  }

  private extractReplyToHeader(value: string | null): string | null {
    if (!value) {
      return null;
    }

    const match = value.match(/replyto\s*[:=]\s*([^\s<>"']+)/i);
    return this.normalizeHostname(match?.[1] ?? null);
  }

  private extractHostnamesFromText(value: string | null): string[] {
    if (!value) {
      return [];
    }

    const matches = value.match(/(?:https?:\/\/[^\s<>"']+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\b)/gi) ?? [];
    const unique = new Set<string>();

    for (const match of matches) {
      const normalized = this.normalizeHostname(match);

      if (normalized) {
        unique.add(normalized);
      }
    }

    return [...unique];
  }

  private extractJid(value: string | null): number | null {
    if (!value) {
      return null;
    }

    const match = value.match(/(?:^|[\.-])gost-(\d+)(?:[\.-]|$)/i);
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

  private normalizeCodeValue(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(Math.trunc(value));
    }

    if (typeof value === "string") {
      const normalized = value.trim();
      return normalized.length > 0 ? normalized : null;
    }

    return null;
  }

  private updateStatus(stage: EtlRunStatus["stage"], message: string): void {
    if (this.currentStatus.status !== "running") {
      return;
    }

    this.currentStatus = {
      ...this.currentStatus,
      stage,
      message
    };
  }
}
