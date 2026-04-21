import { ChangeEvent, FormEvent, useEffect, useState } from "react";

import {
  fetchClinicDirectoryIssues,
  fetchFirebirdConnection,
  saveFirebirdConnection,
  testFirebirdConnection
} from "../../services/api";
import { ClinicDirectoryIssue, FirebirdConfigFormData } from "../../types";

const DEFAULT_PLACEHOLDERS = {
  host: "host.docker.internal",
  port: 3050,
  alias: "proxy_egisz",
  user: "sysdba",
  pass: "masterkey"
} as const;

const INITIAL_FORM: FirebirdConfigFormData = {
  host: "",
  port: 3050,
  alias: "",
  user: "",
  pass: ""
};

type AlertState =
  | {
      tone: "success" | "error";
      message: string;
    }
  | null;

function FieldLabel({ children }: { children: string }): JSX.Element {
  return <label className="mb-2 block text-sm font-medium text-ink/70">{children}</label>;
}

function FieldHint({ children }: { children: string }): JSX.Element {
  return <p className="mt-2 text-xs text-ink/45">{children}</p>;
}

export default function Configuration(): JSX.Element {
  const [form, setForm] = useState<FirebirdConfigFormData>(INITIAL_FORM);
  const [alert, setAlert] = useState<AlertState>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [usesDefaultConfig, setUsesDefaultConfig] = useState(false);
  const [directoryIssues, setDirectoryIssues] = useState<ClinicDirectoryIssue[]>([]);

  useEffect(() => {
    let isMounted = true;

    async function loadConfig(): Promise<void> {
      setIsLoading(true);
      setAlert(null);

      try {
        const [config, issues] = await Promise.all([fetchFirebirdConnection(), fetchClinicDirectoryIssues()]);

        if (!isMounted) {
          return;
        }

        setForm({
          host: config.host,
          port: config.port,
          alias: config.alias,
          user: config.user,
          pass: config.pass
        });
        setUsesDefaultConfig(config.isDefault);
        setDirectoryIssues(issues);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setAlert({
          tone: "error",
          message: error instanceof Error ? error.message : "Не удалось загрузить текущую конфигурацию"
        });
        setUsesDefaultConfig(true);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadConfig();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleChange =
    (field: keyof FirebirdConfigFormData) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      const nextValue = field === "port" ? Number(event.target.value) || 0 : event.target.value;

      setForm((current) => ({
        ...current,
        [field]: nextValue
      }));
      setAlert(null);
    };

  const handleTest = async (event?: FormEvent<HTMLFormElement>): Promise<void> => {
    event?.preventDefault();
    setIsTesting(true);
    setAlert(null);

    try {
      const result = await testFirebirdConnection(form);
      setAlert({
        tone: "success",
        message: result.message || "Соединение с Firebird успешно установлено"
      });
    } catch (error) {
      setAlert({
        tone: "error",
        message: error instanceof Error ? error.message : "Не удалось проверить соединение"
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    setIsSaving(true);
    setAlert(null);

    try {
      const result = await saveFirebirdConnection(form);
      setUsesDefaultConfig(false);
      setAlert({
        tone: "success",
        message: result.message || "Настройки Firebird сохранены"
      });
    } catch (error) {
      setAlert({
        tone: "error",
        message: error instanceof Error ? error.message : "Не удалось сохранить настройки"
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <section className="rounded-[28px] border border-ink/8 bg-white p-6 shadow-card sm:p-8">
          <div className="max-w-2xl">
            <p className="text-sm uppercase tracking-[0.22em] text-ink/40">Firebird</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Параметры подключения
            </h1>
            <p className="mt-3 text-sm leading-6 text-ink/65 sm:text-base">
              Укажите адрес сервера, порт, алиас или путь к базе, затем проверьте соединение и сохраните рабочую конфигурацию.
            </p>
          </div>

          <div className="mt-6 grid gap-3 rounded-2xl border border-ink/8 bg-canvas/55 p-4 text-sm text-ink/65 sm:grid-cols-3">
            <div>
              <p className="font-medium text-ink">Сервер</p>
              <p className="mt-1">Для Docker на Windows обычно подходит `host.docker.internal`.</p>
            </div>
            <div>
              <p className="font-medium text-ink">Порт</p>
              <p className="mt-1">Стандартный порт Firebird: `3050`.</p>
            </div>
            <div>
              <p className="font-medium text-ink">Алиас</p>
              <p className="mt-1">Можно указать алиас Firebird или абсолютный путь к `.fdb`.</p>
            </div>
          </div>

          {usesDefaultConfig ? (
            <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Используются настройки по умолчанию. Они подходят только если Firebird уже доступен по стандартному адресу.
            </div>
          ) : null}

          {directoryIssues.length > 0 ? (
            <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950">
              <p className="font-medium">Обнаружены неверифицированные клиники: {directoryIssues.length}</p>
              <p className="mt-1">
                Эти записи созданы автоматически из технических hostname. Их нужно сопоставить со справочником клиник.
              </p>
              <div className="mt-3 max-h-56 overflow-auto rounded-xl bg-white/70 p-3">
                {directoryIssues.slice(0, 12).map((issue) => (
                  <div key={issue.clinicId} className="border-b border-ink/8 py-2 last:border-b-0">
                    <div className="font-medium text-ink">{issue.jname ?? issue.moUid}</div>
                    <div className="text-xs text-ink/60">
                      hostname: {issue.moDomen ?? "нет"} | mo_uid: {issue.moUid}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {alert ? (
            <div
              className={`mt-6 rounded-2xl border px-4 py-3 text-sm ${
                alert.tone === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-rose-200 bg-rose-50 text-rose-800"
              }`}
            >
              {alert.message}
            </div>
          ) : null}

          {isLoading ? (
            <div className="mt-6 rounded-2xl border border-dashed border-ink/12 bg-canvas/35 p-8 text-center text-ink/55">
              Загрузка текущих настроек...
            </div>
          ) : (
            <form className="mt-6 grid gap-5" onSubmit={(event) => void handleTest(event)}>
              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <FieldLabel>Хост или IP</FieldLabel>
                  <input
                    className="w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base text-ink outline-none transition focus:border-moss focus:ring-2 focus:ring-moss/15"
                    placeholder={DEFAULT_PLACEHOLDERS.host}
                    value={form.host}
                    onChange={handleChange("host")}
                  />
                  <FieldHint>Если Firebird запущен на машине-хосте, начните с `host.docker.internal`.</FieldHint>
                </div>

                <div>
                  <FieldLabel>Порт</FieldLabel>
                  <input
                    className="w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base text-ink outline-none transition focus:border-moss focus:ring-2 focus:ring-moss/15"
                    type="number"
                    min={1}
                    step={1}
                    placeholder={String(DEFAULT_PLACEHOLDERS.port)}
                    value={form.port}
                    onChange={handleChange("port")}
                  />
                </div>

                <div>
                  <FieldLabel>Алиас или путь к БД</FieldLabel>
                  <input
                    className="w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base text-ink outline-none transition focus:border-moss focus:ring-2 focus:ring-moss/15"
                    placeholder={DEFAULT_PLACEHOLDERS.alias}
                    value={form.alias}
                    onChange={handleChange("alias")}
                  />
                  <FieldHint>Например `proxy_egisz` или полный путь вида `C:\data\egisz.fdb`.</FieldHint>
                </div>

                <div>
                  <FieldLabel>Логин</FieldLabel>
                  <input
                    className="w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base text-ink outline-none transition focus:border-moss focus:ring-2 focus:ring-moss/15"
                    placeholder={DEFAULT_PLACEHOLDERS.user}
                    value={form.user}
                    onChange={handleChange("user")}
                  />
                </div>
              </div>

              <div>
                <FieldLabel>Пароль</FieldLabel>
                <input
                  className="w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base text-ink outline-none transition focus:border-moss focus:ring-2 focus:ring-moss/15"
                  type="password"
                  placeholder={DEFAULT_PLACEHOLDERS.pass}
                  value={form.pass}
                  onChange={handleChange("pass")}
                />
              </div>

              <div className="flex flex-col gap-3 border-t border-ink/8 pt-5 sm:flex-row">
                <button
                  className="inline-flex items-center justify-center rounded-full bg-moss px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#2f4833] disabled:cursor-not-allowed disabled:opacity-60"
                  type="submit"
                  disabled={isTesting || isSaving}
                >
                  {isTesting ? "Проверка..." : "Проверить соединение"}
                </button>

                <button
                  className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-6 py-3 text-sm font-semibold text-ink transition hover:bg-canvas/65 disabled:cursor-not-allowed disabled:opacity-60"
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={isTesting || isSaving}
                >
                  {isSaving ? "Сохранение..." : "Сохранить"}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
