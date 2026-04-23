import { ChangeEvent, ReactNode, useEffect, useMemo, useState } from "react";

import {
  fetchDatabaseStatus,
  fetchEtlStatus,
  fetchFirebirdConnection,
  runEtlSync,
  saveFirebirdConnection
} from "../../services/api";
import { DatabaseStatus, EtlRunStatus, FirebirdConfigView } from "../../types";
import { ProgressBar } from "../common/CommonComponents";

type AlertState =
  | {
      tone: "success" | "error";
      message: string;
    }
  | null;

const STATUS_LABELS: Record<EtlRunStatus["stage"], string> = {
  idle: "\u041E\u0436\u0438\u0434\u0430\u043D\u0438\u0435",
  extracting: "\u0418\u0437\u0432\u043B\u0435\u0447\u0435\u043D\u0438\u0435",
  parsing: "\u041F\u0430\u0440\u0441\u0438\u043D\u0433",
  loading: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430",
  success: "\u0417\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u043E",
  failed: "\u041E\u0448\u0438\u0431\u043A\u0430"
};

function buildConnectionSummary(status: DatabaseStatus | null): string {
  if (!status) {
    return "connection.pending";
  }

  if (status.firebird === "ok" && status.postgres === "ok") {
    return "connection.ready";
  }

  return status.details[0] ?? "connection.failed";
}

function getProgressValue(status: EtlRunStatus): number {
  if (status.totalRows > 0) {
    return Math.max(0, Math.min(100, (status.processedRows / status.totalRows) * 100));
  }

  return Math.max(0, Math.min(100, status.progressPercent));
}

function formatDate(value: string | null): string {
  if (!value) {
    return "--";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function InputField({
  id,
  label,
  value,
  onChange,
  type = "text"
}: {
  id: keyof FirebirdConfigView;
  label: string;
  value: string | number;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  type?: string;
}): JSX.Element {
  return (
    <label htmlFor={id} className="block">
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#4B5563]">{label}</span>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={onChange}
        className="mt-2 h-11 w-full rounded-lg bg-[#0F1522] px-3 font-mono text-sm text-white outline-none transition focus:bg-[#111B2B] focus:ring-1 focus:ring-[#509EE3]"
      />
    </label>
  );
}

function ActionButton({
  label,
  onClick,
  href,
  variant = "default",
  disabled = false
}: {
  label: ReactNode;
  onClick?: () => void;
  href?: string;
  variant?: "default" | "metabase";
  disabled?: boolean;
}): JSX.Element {
  const className = `inline-flex min-w-[220px] items-center justify-center rounded-md border px-4 py-2.5 font-mono text-sm transition ${
    variant === "metabase"
      ? disabled
        ? "cursor-not-allowed border-[#314567] bg-[#162133] text-[#657892]"
        : "border-[#F59F36] bg-[#F59F36] text-[#121826] hover:bg-[#FFB95D]"
      : disabled
        ? "cursor-not-allowed border-[#27354D] bg-[#162133] text-[#657892]"
        : "border-[#2D3F5E] bg-[#1B2940] text-[#D1D5DB] hover:border-[#3E5A85] hover:bg-[#223555] hover:text-white"
  }`;

  if (href) {
    return (
      <a
        href={disabled ? "#" : href}
        target={disabled ? undefined : "_blank"}
        rel={disabled ? undefined : "noreferrer"}
        aria-disabled={disabled}
        className={className}
      >
        {label}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
      {label}
    </button>
  );
}

export default function Configuration(): JSX.Element {
  const [alert, setAlert] = useState<AlertState>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [etlStatus, setEtlStatus] = useState<EtlRunStatus>({
    status: "idle",
    stage: "idle",
    message: "ETL is idle",
    progressPercent: 0,
    processedRows: 0,
    totalRows: 0,
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null
  });
  const [connectionStatus, setConnectionStatus] = useState<string>("connection.pending");
  const [dbStatus, setDbStatus] = useState<DatabaseStatus | null>(null);
  const [firebirdConfig, setFirebirdConfig] = useState<FirebirdConfigView>({
    host: "host.docker.internal",
    port: 3050,
    alias: "proxy_egisz",
    user: "SYSDBA",
    pass: "masterkey",
    isDefault: true
  });

  const metabaseUrl = (import.meta as { env?: { VITE_METABASE_URL?: string } }).env?.VITE_METABASE_URL ?? "http://localhost:3001";
  const publicMetabaseUrl =
    (import.meta as { env?: { VITE_METABASE_PUBLIC_URL?: string } }).env?.VITE_METABASE_PUBLIC_URL ?? "http://localhost:3002";

  const isConnected = dbStatus?.firebird === "ok" && dbStatus?.postgres === "ok";
  const progressValue = useMemo(() => getProgressValue(etlStatus), [etlStatus]);
  const processedRows = etlStatus.status === "success" && etlStatus.result ? etlStatus.result.extracted : etlStatus.processedRows;
  const totalRows = etlStatus.status === "success" && etlStatus.result ? etlStatus.result.extracted : etlStatus.totalRows;
  const connectButtonLabel =
    isConnecting
      ? "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435..."
      : isConnected
        ? "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043E"
        : "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u044C\u0441\u044F \u043A Firebird DB";
  const syncButtonLabel =
    isSyncing || etlStatus.status === "running"
      ? "\u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u044F..."
      : "\u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u044F";
  const lastLogLine = useMemo(() => {
    if (alert) {
      return alert.message;
    }

    if (etlStatus.error) {
      return etlStatus.error;
    }

    if (etlStatus.result) {
      return `inserted=${etlStatus.result.inserted} transformed=${etlStatus.result.transformed} skipped=${etlStatus.result.skipped}`;
    }

    return etlStatus.message;
  }, [alert, etlStatus]);

  useEffect(() => {
    let isMounted = true;

    async function loadInitialState(): Promise<void> {
      try {
        const [status, config, databaseStatus] = await Promise.all([
          fetchEtlStatus(),
          fetchFirebirdConnection(),
          fetchDatabaseStatus()
        ]);

        if (!isMounted) {
          return;
        }

        setEtlStatus(status);
        setFirebirdConfig(config);
        setDbStatus(databaseStatus);
        setConnectionStatus(buildConnectionSummary(databaseStatus));

        if (status.status === "success") {
          setAlert({ tone: "success", message: status.message || "sync.success" });
        } else if (status.status === "failed") {
          setAlert({ tone: "error", message: status.error ?? status.message ?? "sync.failed" });
        }
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setAlert({
          tone: "error",
          message: error instanceof Error ? error.message : "init.failed"
        });
      }
    }

    void loadInitialState();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isSyncing) {
      return;
    }

    const timer = window.setInterval(() => {
      void fetchEtlStatus()
        .then((status) => {
          setEtlStatus(status);

          if (status.status === "success") {
            setAlert((current) => current ?? { tone: "success", message: status.message || "sync.success" });
            setIsSyncing(false);
          } else if (status.status === "failed") {
            setAlert({ tone: "error", message: status.error ?? status.message ?? "sync.failed" });
            setIsSyncing(false);
          }
        })
        .catch((error) => {
          setAlert({
            tone: "error",
            message: error instanceof Error ? error.message : "sync.status.failed"
          });
          setIsSyncing(false);
        });
    }, 3000);

    return () => {
      window.clearInterval(timer);
    };
  }, [isSyncing]);

  const handleFieldChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const { name, value } = event.target;
    setFirebirdConfig((prev) => ({
      ...prev,
      [name]: name === "port" ? Number(value) : value
    }));
  };

  const refreshDatabaseState = async (): Promise<DatabaseStatus> => {
    const status = await fetchDatabaseStatus();
    setDbStatus(status);
    setConnectionStatus(buildConnectionSummary(status));
    return status;
  };

  const handleConnect = async (): Promise<void> => {
    setAlert(null);
    setIsConnecting(true);

    try {
      const saveResult = await saveFirebirdConnection(firebirdConfig);
      if (!saveResult.ok) {
        throw new Error(saveResult.message || "connect.failed");
      }

      const optimisticStatus: DatabaseStatus = {
        firebird: "ok",
        postgres: "ok",
        details: []
      };
      setDbStatus(optimisticStatus);
      setConnectionStatus(buildConnectionSummary(optimisticStatus));
      void refreshDatabaseState().catch(() => {});

      setAlert({
        tone: "success",
        message:
          saveResult.message ||
          "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B, \u0441\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u0435 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u043E."
      });
    } catch (error) {
      setConnectionStatus("connection.failed");
      setAlert({
        tone: "error",
        message: error instanceof Error ? error.message : "connect.failed"
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSync = async (): Promise<void> => {
    setIsSyncing(true);

    try {
      const status = await runEtlSync();
      setEtlStatus(status);
    } catch (error) {
      setAlert({
        tone: "error",
        message: error instanceof Error ? error.message : "sync.start.failed"
      });
      setIsSyncing(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#121826] font-mono text-white">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <nav className="flex items-center justify-center gap-3 text-xs">
          <a href="/" className="text-[#509EE3]">
            {"\u041A\u043E\u043D\u0444\u0438\u0433\u0443\u0440\u0430\u0446\u0438\u044F"}
          </a>
          <span className="text-[#4B5563]">|</span>
          <a href={publicMetabaseUrl} target="_blank" rel="noreferrer" className="text-[#4B5563] transition hover:text-[#509EE3]">
            Metabase public
          </a>
          <span className="text-[#4B5563]">|</span>
          <a href="/dashboard" className="text-[#4B5563] transition hover:text-[#509EE3]">
            {"\u0414\u0430\u0448\u0431\u043E\u0440\u0434"}
          </a>
        </nav>

        <section className="mt-8 rounded-lg bg-[#0F1522] px-4 py-5 sm:px-6">
          <div className="mb-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[#4B5563]">Firebird Configuration</div>
            <div className="mt-1 text-sm text-[#9CA3AF]">
              {
                "\u0415\u0441\u043B\u0438 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0437\u0430\u043F\u0443\u0449\u0435\u043D\u043E \u0432 Docker, \u0432 \u043F\u043E\u043B\u0435 host \u0443\u043A\u0430\u0437\u044B\u0432\u0430\u0439\u0442\u0435 "
              }
              <span className="text-white">host.docker.internal</span>
              {" \u0430 \u043D\u0435 "}
              <span className="text-white">localhost</span>.
            </div>
          </div>

          {alert && <div className={`mb-4 text-sm ${alert.tone === "success" ? "text-[#7FB8EA]" : "text-rose-300"}`}>{alert.message}</div>}

          <div className="grid gap-4 sm:grid-cols-2">
            <InputField id="host" label="host" value={firebirdConfig.host} onChange={handleFieldChange} />
            <InputField id="port" label="port" value={firebirdConfig.port} onChange={handleFieldChange} type="number" />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <InputField id="alias" label="database" value={firebirdConfig.alias} onChange={handleFieldChange} />
            <InputField id="user" label="login" value={firebirdConfig.user} onChange={handleFieldChange} />
          </div>
          <div className="mt-4">
            <InputField id="pass" label="password" value={firebirdConfig.pass} onChange={handleFieldChange} type="password" />
          </div>

          <div className="mt-6">
            <div className="mb-1 flex items-center justify-between text-[11px] text-[#4B5563]">
              <span>{STATUS_LABELS[etlStatus.stage]}</span>
              <span>{Math.round(progressValue)}%</span>
            </div>
            <ProgressBar value={progressValue} current={processedRows} total={totalRows} status={etlStatus.status} />
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <ActionButton
              label={
                <span className="inline-flex items-center gap-2">
                  {connectButtonLabel}
                  {isConnected && !isConnecting && <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />}
                </span>
              }
              onClick={() => void handleConnect()}
              disabled={isConnecting || isSyncing}
            />
            <ActionButton
              label={syncButtonLabel}
              onClick={() => void handleSync()}
              disabled={isSyncing || etlStatus.status === "running" || !isConnected}
            />
            <ActionButton label="Metabase" href={metabaseUrl} variant="metabase" disabled={!isConnected} />
          </div>

          <div className="mt-5 rounded-md bg-[#0B1120] px-4 py-4 text-sm text-[#93A1B6]">
            <div className="mb-3 text-[11px] uppercase tracking-[0.16em] text-[#509EE3]">system log</div>
            <div className="space-y-2">
              <div>connection={connectionStatus}</div>
              <div>firebird={dbStatus?.firebird ?? "unknown"}</div>
              <div>postgres={dbStatus?.postgres ?? "unknown"}</div>
              <div>sync={STATUS_LABELS[etlStatus.stage]}</div>
              <div>started={formatDate(etlStatus.startedAt)}</div>
              <div>finished={formatDate(etlStatus.finishedAt)}</div>
              <div className="break-words text-[#D1D5DB]">log={lastLogLine}</div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

