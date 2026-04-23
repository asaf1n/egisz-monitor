import { EgiszErrorRecord, EtlRunResult, EtlRunStatus, FirebirdLicenseLogRow, StarSchemaLogRecord } from "../types";
import { semdDictionary } from '../utils/semdDictionary';
import { FirebirdService } from "./firebird.service";
import { PostgresService } from "./postgres.service";

const CATEGORY_INFRASTRUCTURE = "Infrastructure";
const CATEGORY_FRMR_ERROR = "FRMR_Error";
const CATEGORY_VALIDATION_ERROR = "Validation_Error";
const CATEGORY_SUCCESS = "Success";
const HOSTNAME_TAG_CANDIDATES = ["replyto", "hostname", "host", "address", "url", "endpoint"] as const;
const EXCLUDED_HOSTNAME_FRAGMENTS = [
  "egisz",
  "proxy",
  "host.docker.internal",
  "localhost"
] as const;
const RAW_NETWORK_ERROR_PATTERN = /(Socket error|Host not found|CA_INACCESSIBILITY)/i;
const FIREBIRD_ETL_PAGE_SIZE = (() => {
  const parsed = Number(process.env.FIREBIRD_ETL_PAGE_SIZE ?? "200");
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 200;
})();

type ParsedMessageMetadata = {
  isXml: boolean;
  parsedStatus: "success" | "error" | null;
  errorCode: string | null;
  errorMessage: string | null;
  fallbackJid: number | null;
  fallbackKind: string | null;
  hasRawNetworkError: boolean;
  hostname: string | null;
};

const EMPTY_PARSED_MESSAGE_METADATA: ParsedMessageMetadata = {
  isXml: false,
  parsedStatus: null,
  errorCode: null,
  errorMessage: null,
  fallbackJid: null,
  fallbackKind: null,
  hasRawNetworkError: false,
  hostname: null,
};

export class EtlService {
  private static readonly ETL_BATCH_SIZE = 500;
  private static readonly FIREBIRD_PAGE_SIZE = FIREBIRD_ETL_PAGE_SIZE;
  private currentRun: Promise<void> | null = null;
  private readonly batchSize: number;
  private currentStatus: EtlRunStatus = {
    status: "idle",
    stage: "idle",
    message: "ETL is idle",
    progress: {
      current: 0,
      total: 0,
      percent: 0
    },
    progressPercent: 0,
    processedRows: 0,
    totalRows: 0,
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null
  };

  constructor(
    private readonly firebirdService: FirebirdService,
    private readonly postgresService: PostgresService,
    batchSize: number
  ) {
    this.batchSize = EtlService.ETL_BATCH_SIZE;

    if (batchSize !== EtlService.ETL_BATCH_SIZE) {
      console.warn(
        `[ETL] Ignoring configured batch size ${batchSize}. Using fixed batch size ${EtlService.ETL_BATCH_SIZE}.`
      );
    }
  }

  start(): EtlRunStatus {
    if (this.currentRun) {
      return this.getStatus();
    }

    const startedAt = new Date().toISOString();
    this.currentStatus = {
      status: "running",
      stage: "extracting",
      message: "Extracting exchange logs from Firebird",
      progress: {
        current: 0,
        total: 0,
        percent: 0
      },
      progressPercent: 0,
      processedRows: 0,
      totalRows: 0,
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
          progress: {
            current: this.currentStatus.processedRows,
            total: this.currentStatus.totalRows,
            percent: 100
          },
          progressPercent: 100,
          processedRows: this.currentStatus.processedRows,
          totalRows: this.currentStatus.totalRows,
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
          progress: {
            current: this.currentStatus.processedRows,
            total: this.currentStatus.totalRows,
            percent: this.currentStatus.progressPercent
          },
          progressPercent: this.currentStatus.progressPercent,
          processedRows: this.currentStatus.processedRows,
          totalRows: this.currentStatus.totalRows,
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
    const startedAt = new Date().toISOString();
    this.currentStatus = {
      status: "running",
      stage: "extracting",
      message: "Extracting exchange logs from Firebird",
      progress: {
        current: 0,
        total: 0,
        percent: 0
      },
      progressPercent: 0,
      processedRows: 0,
      totalRows: 0,
      startedAt,
      finishedAt: null,
      result: null,
      error: null
    };

    try {
      const result = await this.runInternal();
      const finishedAt = new Date().toISOString();
      this.currentStatus = {
        status: "success",
        stage: "success",
        message: `ETL completed: inserted ${result.inserted} rows from ${result.extracted}`,
        progress: {
          current: this.currentStatus.processedRows,
          total: this.currentStatus.totalRows,
          percent: 100
        },
        progressPercent: 100,
        processedRows: this.currentStatus.processedRows,
        totalRows: this.currentStatus.totalRows,
        startedAt,
        finishedAt,
        result,
        error: null
      };
      return result;
    } catch (error) {
      const finishedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : "Unknown ETL error";
      this.currentStatus = {
        status: "failed",
        stage: "failed",
        message,
        progress: {
          current: this.currentStatus.processedRows,
          total: this.currentStatus.totalRows,
          percent: this.currentStatus.progressPercent
        },
        progressPercent: this.currentStatus.progressPercent,
        processedRows: this.currentStatus.processedRows,
        totalRows: this.currentStatus.totalRows,
        startedAt,
        finishedAt,
        result: null,
        error: message
      };
      console.error(`ETL run failed at ${finishedAt}`, error);
      throw error;
    }
  }

  canonicalizeHostname(raw: string): string {
    const normalized = this.normalizeHostname(raw);
    return normalized ?? "";
  }

  private async runInternal(): Promise<EtlRunResult> {
    return this.postgresService.withEtlLock(async () => {
      const startedAt = new Date().toISOString();
      console.log(`ETL run started at ${startedAt}`);
      this.updateStatus("extracting", "Counting source rows in Firebird");
      const totalRows = await this.firebirdService.fetchExchangeLogCount();
      this.updateStatus("extracting", "Extracting exchange logs from Firebird", 0, totalRows);
      await this.postgresService.ensureSchema();
      const totalForProgress = Math.max(totalRows, 0);
      const extractionStartedAt = Date.now();
      let extracted = 0;
      let transformed = 0;
      let inserted = 0;
      let skipped = 0;
      let processed = 0;
      let pageNumber = 0;
      let skip = 0;

      while (true) {
        pageNumber += 1;
        const elapsedSeconds = Math.floor((Date.now() - extractionStartedAt) / 1000);

        this.updateStatus(
          "extracting",
          `Extracting Firebird page ${pageNumber} (offset ${skip}, ${elapsedSeconds}s elapsed)`,
          processed,
          totalForProgress
        );

        const fetchStartedAt = Date.now();
        console.log(
          `[ETL] Fetching Firebird page ${pageNumber} (offset=${skip}, limit=${EtlService.FIREBIRD_PAGE_SIZE})`
        );
        const fetchHeartbeat = setInterval(() => {
          const totalElapsedSeconds = Math.floor((Date.now() - extractionStartedAt) / 1000);
          const fetchElapsedSeconds = Math.floor((Date.now() - fetchStartedAt) / 1000);
          this.updateStatus(
            "extracting",
            `Waiting Firebird page ${pageNumber} (offset ${skip}, page ${fetchElapsedSeconds}s, total ${totalElapsedSeconds}s)`,
            processed,
            totalForProgress
          );
        }, 5000);

        let sourceRows: FirebirdLicenseLogRow[];
        try {
          sourceRows = await this.firebirdService.fetchLicenseExchangeLogsPage(skip, EtlService.FIREBIRD_PAGE_SIZE);
        } finally {
          clearInterval(fetchHeartbeat);
        }
        const fetchDurationMs = Date.now() - fetchStartedAt;
        console.log(
          `[ETL] Completed fetch for Firebird page ${pageNumber} in ${fetchDurationMs}ms (rows=${sourceRows.length})`
        );

        if (sourceRows.length === 0) {
          break;
        }

        extracted += sourceRows.length;
        this.updateStatus(
          "parsing",
          `Parsing page ${pageNumber}: ${sourceRows.length} Firebird rows`,
          processed,
          totalForProgress
        );

        const totalBatches = Math.ceil(sourceRows.length / this.batchSize);
        console.log(
          `[ETL] Firebird page ${pageNumber} extracted (${sourceRows.length} rows). Parsing and loading ${totalBatches} batch(es).`
        );

        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
          const batchNumber = batchIndex + 1;
          const batchStart = batchIndex * this.batchSize;
          const batchEnd = Math.min(batchStart + this.batchSize, sourceRows.length);
          let rows: StarSchemaLogRecord[] = [];

          console.log(`[ETL] Processing page ${pageNumber}, batch ${batchNumber} of ${totalBatches}...`);

          for (let index = batchStart; index < batchEnd; index += 1) {
            const row = sourceRows[index];

            try {
              const normalized = await this.normalizeRow(row);

              if (normalized) {
                rows.push(normalized);
                transformed += 1;
              } else {
                skipped += 1;
              }
            } catch (error) {
              skipped += 1;

              const logId = this.readLogId(row);
              const message = error instanceof Error ? error.message : "Unknown row normalization error";
              console.error(`[ETL] Skipping Firebird row LOGID=${logId}. ${message}`, error);
            }

            processed += 1;

            if (processed % 100 === 0) {
              this.updateStatus(
                "parsing",
                `Parsed ${processed} Firebird rows`,
                processed,
                totalForProgress
              );
            }
          }

          this.updateStatus(
            "loading",
            `Loading page ${pageNumber}, batch ${batchNumber} of ${totalBatches} into PostgreSQL`,
            processed,
            totalForProgress
          );

          if (rows.length > 0) {
            inserted += await this.postgresService.upsertStarSchemaBatch(rows);
            rows = [];
          }

          this.updateStatus("loading", `Loaded ${processed} Firebird rows`, processed, totalForProgress);
        }

        this.updateStatus("extracting", `Finished Firebird page ${pageNumber}`, processed, totalForProgress);
        skip += sourceRows.length;

        if (sourceRows.length < EtlService.FIREBIRD_PAGE_SIZE) {
          break;
        }
      }

      const result = {
        extracted,
        transformed,
        inserted,
        skipped
      };

      console.log(`ETL run completed at ${new Date().toISOString()}. Inserted ${result.inserted} rows from ${result.extracted}.`);

      return result;
    });
  }

  private async normalizeRow(row: FirebirdLicenseLogRow): Promise<StarSchemaLogRecord | null> {
    const originalLogId = this.toRequiredNumber(row.LOGID ?? row.EXCHANGELOG_ID, "LOGID");
    const logText = this.normalizeText(this.toOptionalString(row.LOGTEXT));
    const messageText =
      this.normalizeText(this.toOptionalString(row.MSGTEXT)) ??
      this.normalizeText(this.toOptionalString(row.MESSAGE_MSGTEXT));
    const uri = this.normalizeText(this.toOptionalString(row.URI));
    const method = this.normalizeText(this.toOptionalString(row.METHOD));
    const action = this.normalizeText(this.toOptionalString(row.ACTION));
    const explicitDomain = this.normalizeClinicHostname(this.normalizeText(this.toOptionalString(row.MO_DOMEN)));
    const parsedMessage = this.parseMessageMetadata(messageText);
    const hostnameCandidates = this.collectHostnameCandidates(
      this.normalizeText(this.toOptionalString(row.REPLYTO)),
      parsedMessage.hostname,
      logText,
      messageText
    );
    const hostname = this.findTargetClinicHostname(hostnameCandidates);
    const clinicDomain = explicitDomain ?? hostname;
    const parentLogId = this.toOptionalNumber(row.PARENTLOGID) ?? this.toOptionalNumber(row.GRPID);
    const resolvedJid = this.toOptionalNumber(row.JID) ?? parsedMessage.fallbackJid;
    const unresolvedClinicMarker =
      this.normalizeCodeValue(row.DOCUMENTID) ??
      this.normalizeCodeValue(parentLogId) ??
      this.normalizeCodeValue(originalLogId) ??
      "unknown";
    const isUnresolvedClinic = resolvedJid === null;
    const jid = resolvedJid ?? 0;
    const moUid =
      isUnresolvedClinic
        ? `unresolved-jid-${unresolvedClinicMarker}`
        : (
            // MO_UID must come from EGISZ_LICENSES.MO_UID first.
            this.normalizeText(this.toOptionalString(row.MO_UID)) ??
            clinicDomain ??
            `log-group-${parentLogId ?? originalLogId}`
          );
    const jname =
      isUnresolvedClinic
        ? `Не сопоставлено (нет JID) [${unresolvedClinicMarker}]`
        : this.normalizeText(this.toOptionalString(row.JNAME));
    const serviceDescription = this.buildServiceDescription(uri, method, action, row);
    const kindCode = this.normalizeCodeValue(row.KIND) ?? parsedMessage.fallbackKind;
    const kindLabel = kindCode ?? "UNKNOWN";
    const normalizedDocumentName = semdDictionary[kindLabel] ?? `[${kindLabel}] \u041d\u0430\u0438\u043c\u0435\u043d\u043e\u0432\u0430\u043d\u0438\u0435 \u0421\u042d\u041c\u0414 \u043e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442`;
    const kind = kindCode ?? "UNKNOWN";
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
    const hasInfrastructureError =
      parsedMessage.hasRawNetworkError ||
      RAW_NETWORK_ERROR_PATTERN.test(logText ?? "") ||
      logState === 3;
    const statusFromPayload = parsedMessage.parsedStatus;
    const status =
      statusFromPayload === "success"
        ? "success"
        : statusFromPayload === "error" || hasInfrastructureError || Boolean(parsedMessage.errorCode) || Boolean(parsedMessage.errorMessage)
          ? "error"
          : "success";
    const parsedCategory = this.classifyErrorCategory(status, parsedMessage.errorCode, parsedMessage.errorMessage, hasInfrastructureError);
    const errorCategory = status === "error" ? parsedCategory : null;
    const errorMessage = status === "error"
      ? this.normalizeText(parsedMessage.errorMessage) ?? this.normalizeText(logText ?? messageText)
      : null;
    const errorCode = status === "error" ? this.normalizeCodeValue(parsedMessage.errorCode) : null;
    const errorText = this.normalizeText(errorMessage ?? logText ?? messageText);

    return {
      clinic: {
        jid,
        moUid,
        moDomen: clinicDomain,
        jname,
        isVerified: !isUnresolvedClinic && Boolean(explicitDomain || jname)
      },
      service: {
        kind,
        serviceType,
        description: normalizedDocumentName ?? serviceDescription
      },
      fact: {
        originalLogId,
        transactionDate,
        status,
        errorCategory,
        errorCode,
        errorMessage,
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

  private readLogId(row: FirebirdLicenseLogRow): string {
    return String(row.LOGID ?? row.EXCHANGELOG_ID ?? "unknown");
  }

  private parseMessageMetadata(messageText: string | null): ParsedMessageMetadata {
    if (!messageText) {
      return { ...EMPTY_PARSED_MESSAGE_METADATA };
    }

    const trimmed = messageText.trim();

    if (/^<\?xml/i.test(trimmed)) {
      return this.parseXmlMessageMetadata(trimmed);
    }

    return this.parseRawMessageMetadata(trimmed);
  }

  private parseRawMessageMetadata(rawText: string): ParsedMessageMetadata {
    return {
      ...EMPTY_PARSED_MESSAGE_METADATA,
      hasRawNetworkError: RAW_NETWORK_ERROR_PATTERN.test(rawText)
    };
  }

  private parseXmlMessageMetadata(xmlText: string): ParsedMessageMetadata {
    const errorCode = this.extractFirstXmlTagValue(xmlText, "code");
    const errorMessage = this.extractFirstXmlTagValue(xmlText, "message");
    const organization = this.extractFirstXmlTagValue(xmlText, "organization");
    const fallbackJid = this.toOptionalNumber(organization);
    const fallbackKind = this.normalizeCodeValue(this.extractFirstXmlTagValue(xmlText, "kind"));
    const explicitStatus = this.extractFirstXmlTagValue(xmlText, "status")?.toLowerCase();
    const status =
      explicitStatus === "success"
        ? "success"
        : explicitStatus === "error"
          ? "error"
          : /ResponseStatusType:Success/i.test(xmlText)
            ? "success"
            : "error";

    const hostnameCandidates = HOSTNAME_TAG_CANDIDATES
      .map((tag) => this.extractFirstXmlTagValue(xmlText, tag))
      .filter((candidate): candidate is string => Boolean(candidate));
    const hostname = this.findTargetClinicHostname(hostnameCandidates);

    return {
      isXml: true,
      parsedStatus: status,
      errorCode: this.normalizeCodeValue(errorCode),
      errorMessage: this.normalizeText(errorMessage),
      fallbackJid,
      fallbackKind,
      hasRawNetworkError: false,
      hostname
    };
  }

  private extractFirstXmlTagValue(xmlText: string, tagName: string): string | null {
    const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expression = new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${escapedTagName}>\\s*([\\s\\S]*?)\\s*<\\/(?:(?:[A-Za-z_][\\w.-]*):)?${escapedTagName}>`, "i");
    const match = expression.exec(xmlText);
    return this.normalizeText(match?.[1] ?? null);
  }

  private classifyErrorCategory(
    status: "success" | "error",
    errorCode: string | null,
    errorMessage: string | null,
    hasInfrastructureError: boolean
  ): string {
    if (status === "success") {
      return CATEGORY_SUCCESS;
    }

    if (hasInfrastructureError) {
      return CATEGORY_INFRASTRUCTURE;
    }

    const normalizedCode = errorCode?.toUpperCase() ?? "";
    const normalizedMessage = errorMessage?.toUpperCase() ?? "";
    const validationPattern = /(VALIDATION|XSD|SCHEMA|NSI|REQUIRED|MISMATCH)/i;

    if (normalizedCode.includes("FRMR")) {
      return CATEGORY_FRMR_ERROR;
    }

    if (validationPattern.test(normalizedCode) || validationPattern.test(normalizedMessage)) {
      return CATEGORY_VALIDATION_ERROR;
    }

    return CATEGORY_FRMR_ERROR;
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

    const hostMatch = value.match(/gost-(\d+)\.infoclinica\.lan/i);
    if (hostMatch) {
      return Number(hostMatch[1]);
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

  private updateStatus(
    stage: EtlRunStatus["stage"],
    message: string,
    processedRows = this.currentStatus.processedRows,
    totalRows = this.currentStatus.totalRows
  ): void {
    if (this.currentStatus.status !== "running") {
      return;
    }

    const safeTotal = Math.max(totalRows, 0);
    const safeProcessed = Math.max(processedRows, 0);
    const computedProgress =
      safeTotal > 0 ? Math.round((safeProcessed / safeTotal) * 100) : this.currentStatus.progressPercent;
    const progressPercent = Math.min(100, Math.max(0, computedProgress));

    this.currentStatus = {
      ...this.currentStatus,
      stage,
      message,
      progress: {
        current: safeProcessed,
        total: safeTotal,
        percent: progressPercent
      },
      progressPercent,
      processedRows: safeProcessed,
      totalRows: safeTotal
    };
  }
}
