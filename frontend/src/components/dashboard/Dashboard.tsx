import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import {
  fetchClinicErrors,
  fetchDashboardKpi,
  fetchErrorsPie,
  fetchHourlyTrend,
  fetchServiceHealth,
  fetchStatusHeatmap,
  runEtlSync
} from "../../services/api";
import {
  ClinicErrorRow,
  DashboardKPI,
  ErrorPieData,
  HourlyTrendRow,
  ServiceHealthRow,
  StatusHeatmapRow
} from "../../types";

const PIE_COLORS = ["#36543b", "#b25f3f", "#d89d56", "#8a4b2f", "#6e8f5a"];
const SUCCESS_COLOR = "#36543b";
const ERROR_COLOR = "#b25f3f";

const EMPTY_KPI: DashboardKPI = {
  total: 0,
  successRate: 0,
  uniqueErrors: 0
};

const STATUS_STYLES: Record<
  StatusHeatmapRow["status"],
  { badge: string; row: string; label: string }
> = {
  green: {
    badge: "bg-emerald-500",
    row: "bg-emerald-50/75",
    label: "Норма"
  },
  yellow: {
    badge: "bg-amber-400",
    row: "bg-amber-50/75",
    label: "Риск"
  },
  red: {
    badge: "bg-rose-500",
    row: "bg-rose-50/75",
    label: "Сбой"
  }
};

function formatDate(value: string | null): string {
  if (!value) {
    return "Нет данных";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatHourLabel(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function KpiCard({ title, value, accent }: { title: string; value: string; accent: string }): JSX.Element {
  return (
    <article className="rounded-3xl border border-ink/8 bg-white p-6 shadow-card">
      <div className={`mb-4 h-1.5 w-14 rounded-full ${accent}`} />
      <p className="text-sm text-ink/55">{title}</p>
      <p className="mt-3 text-4xl font-semibold text-ink">{value}</p>
    </article>
  );
}

function ChartCard({
  eyebrow,
  title,
  children
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <article className="rounded-3xl border border-ink/8 bg-canvas/35 p-6">
      <p className="text-sm text-ink/45">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-semibold text-ink">{title}</h2>
      <div className="mt-6">{children}</div>
    </article>
  );
}

export function Dashboard(): JSX.Element {
  const [kpi, setKpi] = useState<DashboardKPI>(EMPTY_KPI);
  const [errorsPie, setErrorsPie] = useState<ErrorPieData[]>([]);
  const [statusRows, setStatusRows] = useState<StatusHeatmapRow[]>([]);
  const [hourlyTrend, setHourlyTrend] = useState<HourlyTrendRow[]>([]);
  const [clinicErrors, setClinicErrors] = useState<ClinicErrorRow[]>([]);
  const [serviceHealth, setServiceHealth] = useState<ServiceHealthRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alert, setAlert] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  async function loadDashboard(options?: { silent?: boolean }): Promise<void> {
    if (!options?.silent) {
      setIsLoading(true);
    }

    setError(null);

    try {
      const [kpiData, pieData, heatmapData, trendData, clinicData, serviceData] = await Promise.all([
        fetchDashboardKpi(),
        fetchErrorsPie(),
        fetchStatusHeatmap(),
        fetchHourlyTrend(),
        fetchClinicErrors(),
        fetchServiceHealth()
      ]);

      setKpi(kpiData);
      setErrorsPie(pieData);
      setStatusRows(heatmapData);
      setHourlyTrend(trendData);
      setClinicErrors(clinicData);
      setServiceHealth(serviceData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить данные дашборда");
    } finally {
      if (!options?.silent) {
        setIsLoading(false);
      }
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  async function handleSync(): Promise<void> {
    setIsSyncing(true);
    setAlert(null);

    try {
      const result = await runEtlSync();
      await loadDashboard({ silent: true });
      setAlert({
        tone: "success",
        message: `Синхронизация завершена. Загружено ${result.inserted} записей из ${result.extracted}.`
      });
    } catch (syncError) {
      setAlert({
        tone: "error",
        message: syncError instanceof Error ? syncError.message : "Не удалось синхронизировать данные"
      });
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <section className="rounded-[28px] border border-ink/8 bg-white p-6 shadow-card sm:p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm uppercase tracking-[0.22em] text-ink/40">Дашборд</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                Монитор обмена с ЕГИСЗ
              </h1>
              <p className="mt-3 text-sm leading-6 text-ink/65 sm:text-base">
                Сводка по загрузкам, ошибкам интеграции, динамике обменов и стабильности сервисов по данным ETL.
              </p>
            </div>

            <div className="flex flex-col items-start gap-3 md:items-end">
              <button
                className="inline-flex items-center justify-center rounded-full bg-moss px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#2f4833] disabled:cursor-not-allowed disabled:opacity-70"
                type="button"
                onClick={() => void handleSync()}
                disabled={isLoading || isSyncing}
              >
                {isSyncing ? "Синхронизация..." : "Синхронизировать данные"}
              </button>
              <div className="rounded-full border border-ink/8 bg-canvas/70 px-4 py-2 text-sm text-ink/55">
                Источник: Firebird, витрина: PostgreSQL
              </div>
            </div>
          </div>

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
            <div className="mt-8 rounded-2xl border border-dashed border-ink/12 bg-canvas/35 p-10 text-center text-ink/55">
              Загрузка аналитики...
            </div>
          ) : error ? (
            <div className="mt-8 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800">
              Ошибка загрузки: {error}
            </div>
          ) : (
            <>
              <section className="mt-8 grid gap-4 md:grid-cols-3">
                <KpiCard title="Всего записей за 24 часа" value={kpi.total.toLocaleString("ru-RU")} accent="bg-moss" />
                <KpiCard title="Успешных, %" value={`${kpi.successRate.toFixed(2)}%`} accent="bg-clay" />
                <KpiCard
                  title="Уникальных ошибок"
                  value={kpi.uniqueErrors.toLocaleString("ru-RU")}
                  accent="bg-amber-500"
                />
              </section>

              <section className="mt-8 grid gap-6 xl:grid-cols-[1fr_1.1fr]">
                <ChartCard eyebrow="Ошибки" title="Распределение категорий за 24 часа">
                  <div className="h-[320px]">
                    {errorsPie.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={errorsPie}
                            dataKey="count"
                            nameKey="category"
                            innerRadius={70}
                            outerRadius={110}
                            paddingAngle={4}
                          >
                            {errorsPie.map((entry, index) => (
                              <Cell key={`${entry.category}-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value: number) => value.toLocaleString("ru-RU")} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-ink/12 bg-white/60 text-ink/55">
                        Ошибок за период не найдено
                      </div>
                    )}
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {errorsPie.map((item, index) => (
                      <div key={item.category} className="flex items-center justify-between rounded-2xl bg-white px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                          />
                          <span className="text-sm text-ink/75">{item.category}</span>
                        </div>
                        <span className="text-sm font-semibold text-ink">{item.count.toLocaleString("ru-RU")}</span>
                      </div>
                    ))}
                  </div>
                </ChartCard>

                <ChartCard eyebrow="Поток обмена" title="Почасовая динамика успехов и ошибок">
                  <div className="h-[360px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={hourlyTrend}>
                        <CartesianGrid stroke="#d8d6d0" strokeDasharray="3 3" />
                        <XAxis
                          dataKey="hourBucket"
                          tickFormatter={formatHourLabel}
                          stroke="#4d564f"
                          fontSize={12}
                        />
                        <YAxis stroke="#4d564f" fontSize={12} allowDecimals={false} />
                        <Tooltip
                          labelFormatter={(label) => formatDate(String(label))}
                          formatter={(value: number) => value.toLocaleString("ru-RU")}
                        />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="successCount"
                          name="Успешно"
                          stroke={SUCCESS_COLOR}
                          strokeWidth={3}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="errorCount"
                          name="Ошибки"
                          stroke={ERROR_COLOR}
                          strokeWidth={3}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>
              </section>

              <section className="mt-8 grid gap-6 xl:grid-cols-[1.15fr_1fr]">
                <ChartCard eyebrow="Проблемные МО" title="Топ организаций по ошибкам за 7 дней">
                  {clinicErrors.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full border-separate border-spacing-y-3">
                        <thead>
                          <tr className="text-left text-sm text-ink/45">
                            <th className="px-4 py-2">МО UID</th>
                            <th className="px-4 py-2">Ошибок</th>
                            <th className="px-4 py-2">Всего</th>
                            <th className="px-4 py-2">Успешность</th>
                            <th className="px-4 py-2">Последняя ошибка</th>
                          </tr>
                        </thead>
                        <tbody>
                          {clinicErrors.map((row) => (
                            <tr key={row.moUid} className="bg-white text-sm text-ink">
                              <td className="rounded-l-2xl px-4 py-4 font-medium">{row.moUid}</td>
                              <td className="px-4 py-4 text-rose-700">{row.errorCount.toLocaleString("ru-RU")}</td>
                              <td className="px-4 py-4">{row.totalCount.toLocaleString("ru-RU")}</td>
                              <td className="px-4 py-4">{row.successRate.toFixed(2)}%</td>
                              <td className="rounded-r-2xl px-4 py-4 text-ink/70">{formatDate(row.lastErrorAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-ink/12 bg-white/60 p-6 text-center text-ink/55">
                      За последние 7 дней проблемные организации не выявлены
                    </div>
                  )}
                </ChartCard>

                <ChartCard eyebrow="Состояние сервисов" title="Ошибки по типам сервисов за 7 дней">
                  {serviceHealth.length > 0 ? (
                    <div className="h-[360px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={serviceHealth.slice(0, 8)} layout="vertical" margin={{ left: 16, right: 16 }}>
                          <CartesianGrid stroke="#d8d6d0" strokeDasharray="3 3" />
                          <XAxis type="number" stroke="#4d564f" fontSize={12} allowDecimals={false} />
                          <YAxis
                            type="category"
                            dataKey="semdType"
                            stroke="#4d564f"
                            fontSize={12}
                            width={90}
                          />
                          <Tooltip formatter={(value: number) => value.toLocaleString("ru-RU")} />
                          <Legend />
                          <Bar dataKey="successCount" name="Успешно" fill={SUCCESS_COLOR} radius={[0, 10, 10, 0]} />
                          <Bar dataKey="errorCount" name="Ошибки" fill={ERROR_COLOR} radius={[0, 10, 10, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-ink/12 bg-white/60 p-6 text-center text-ink/55">
                      Нет данных по сервисам
                    </div>
                  )}
                </ChartCard>
              </section>

              <section className="mt-8 grid gap-6 xl:grid-cols-[1.15fr_1fr]">
                <ChartCard eyebrow="Активность МО" title="Статусы последних обменов">
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-separate border-spacing-y-3">
                      <thead>
                        <tr className="text-left text-sm text-ink/45">
                          <th className="px-4 py-2">МО UID</th>
                          <th className="px-4 py-2">Сервис</th>
                          <th className="px-4 py-2">Последняя активность</th>
                          <th className="px-4 py-2">Статус</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statusRows.map((row) => {
                          const styles = STATUS_STYLES[row.status];

                          return (
                            <tr key={`${row.mo_uid}-${row.kind}`} className={`${styles.row} text-sm text-ink`}>
                              <td className="rounded-l-2xl px-4 py-4 font-medium">{row.mo_uid}</td>
                              <td className="px-4 py-4">{row.kind}</td>
                              <td className="px-4 py-4 text-ink/70">{formatDate(row.last_activity)}</td>
                              <td className="rounded-r-2xl px-4 py-4">
                                <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-ink/75">
                                  <span className={`h-2.5 w-2.5 rounded-full ${styles.badge}`} />
                                  {styles.label}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {statusRows.length === 0 ? (
                      <div className="mt-4 rounded-2xl border border-dashed border-ink/12 bg-white/60 p-6 text-center text-ink/55">
                        Нет данных по активности медицинских организаций
                      </div>
                    ) : null}
                  </div>
                </ChartCard>

                <ChartCard eyebrow="Сводка сервисов" title="Текущая стабильность интеграционных контуров">
                  {serviceHealth.length > 0 ? (
                    <div className="space-y-3">
                      {serviceHealth.slice(0, 8).map((row) => (
                        <div key={row.semdType} className="rounded-2xl bg-white px-4 py-4">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-sm font-semibold text-ink">{row.semdType}</p>
                              <p className="mt-1 text-xs text-ink/50">Последний обмен: {formatDate(row.lastExchangeAt)}</p>
                            </div>
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                row.errorCount === 0
                                  ? "bg-emerald-50 text-emerald-800"
                                  : row.successRate >= 95
                                    ? "bg-amber-50 text-amber-800"
                                    : "bg-rose-50 text-rose-800"
                              }`}
                            >
                              {row.successRate.toFixed(2)}%
                            </span>
                          </div>
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-canvas">
                            <div
                              className="h-full rounded-full bg-moss"
                              style={{ width: `${Math.max(4, Math.min(100, row.successRate))}%` }}
                            />
                          </div>
                          <div className="mt-3 flex items-center justify-between text-xs text-ink/55">
                            <span>Успешно: {row.successCount.toLocaleString("ru-RU")}</span>
                            <span>Ошибки: {row.errorCount.toLocaleString("ru-RU")}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-ink/12 bg-white/60 p-6 text-center text-ink/55">
                      Нет агрегированных данных по стабильности сервисов
                    </div>
                  )}
                </ChartCard>
              </section>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

export default Dashboard;
