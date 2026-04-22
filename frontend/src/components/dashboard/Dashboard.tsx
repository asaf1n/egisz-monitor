import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
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
  fetchCostlyClinics,
  fetchDashboardKpi,
  fetchErrorsPie,
  fetchHourlyTrend,
  fetchServiceHealth,
  fetchStatusHeatmap,
  fetchVpnNodeStatus
} from "../../services/api";
import {
  ClinicErrorRow,
  CostlyClinicRow,
  DashboardKPI,
  ErrorPieData,
  HourlyTrendRow,
  ServiceHealthRow,
  StatusHeatmapRow,
  VpnNodeRow
} from "../../types";

const PIE_COLORS = ["#36543b", "#b25f3f", "#d89d56", "#8a4b2f", "#6e8f5a"];
const SUCCESS_COLOR = "#36543b";
const ERROR_COLOR = "#b25f3f";

const EMPTY_KPI: DashboardKPI = {
  total: 0,
  successRate: 0,
  uniqueErrors: 0
};

const STATUS_STYLES: Record<StatusHeatmapRow["status"], { badge: string; row: string; label: string }> = {
  green: { badge: "bg-emerald-500", row: "bg-emerald-50/75", label: "Норма" },
  yellow: { badge: "bg-amber-400", row: "bg-amber-50/75", label: "Риск" },
  red: { badge: "bg-rose-500", row: "bg-rose-50/75", label: "Сбой" }
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

function ChartCard({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }): JSX.Element {
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
  const [costlyClinics, setCostlyClinics] = useState<CostlyClinicRow[]>([]);
  const [vpnNodes, setVpnNodes] = useState<VpnNodeRow[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState("24h");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const periodOptions = [
    { label: "24 часа", value: "24h" },
    { label: "7 дней", value: "7d" },
    { label: "30 дней", value: "30d" }
  ];

  async function loadDashboard(period = selectedPeriod, options?: { silent?: boolean }): Promise<void> {
    if (!options?.silent) {
      setIsLoading(true);
    }

    setError(null);

    try {
      const [kpiData, pieData, heatmapData, trendData, clinicData, serviceData, costlyClinicData, vpnNodeData] =
        await Promise.all([
          fetchDashboardKpi(period),
          fetchErrorsPie(period),
          fetchStatusHeatmap(period),
          fetchHourlyTrend(period),
          fetchClinicErrors(period),
          fetchServiceHealth(period),
          fetchCostlyClinics(period),
          fetchVpnNodeStatus(period)
        ]);

      setKpi(kpiData);
      setErrorsPie(pieData);
      setStatusRows(heatmapData);
      setHourlyTrend(trendData);
      setClinicErrors(clinicData);
      setServiceHealth(serviceData);
      setCostlyClinics(costlyClinicData);
      setVpnNodes(vpnNodeData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить данные дашборда");
    } finally {
      if (!options?.silent) {
        setIsLoading(false);
      }
    }
  }

  function handlePeriodChange(event: ChangeEvent<HTMLSelectElement>): void {
    const nextPeriod = event.target.value;
    setSelectedPeriod(nextPeriod);
    void loadDashboard(nextPeriod);
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  const periodLabel = periodOptions.find((option) => option.value === selectedPeriod)?.label ?? "24 часа";

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
                Единая оперативная витрина по обменам, ошибкам, активности клиник и стабильности сервисов.
              </p>
            </div>

            <div className="flex flex-col items-start gap-3 md:items-end">
              <div className="inline-flex items-center gap-2 rounded-full border border-ink/10 bg-white px-3 py-2 text-sm text-ink shadow-sm">
                <label htmlFor="period" className="text-ink/70">
                  Период
                </label>
                <select
                  id="period"
                  value={selectedPeriod}
                  onChange={handlePeriodChange}
                  className="rounded-full border border-ink/10 bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-moss focus:ring-2 focus:ring-moss/15"
                >
                  {periodOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="rounded-full border border-ink/8 bg-canvas/70 px-4 py-2 text-sm text-ink/55">
                Источник: Firebird, аналитика: PostgreSQL / Metabase
              </div>
            </div>
          </div>

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
                <KpiCard title={`Всего записей за ${periodLabel.toLowerCase()}`} value={kpi.total.toLocaleString("ru-RU")} accent="bg-moss" />
                <KpiCard title="Успешных, %" value={`${kpi.successRate.toFixed(2)}%`} accent="bg-clay" />
                <KpiCard title="Уникальных ошибок" value={kpi.uniqueErrors.toLocaleString("ru-RU")} accent="bg-amber-500" />
              </section>

              <section className="mt-8 grid gap-6 xl:grid-cols-[1fr_1.1fr]">
                <ChartCard eyebrow="Ошибки" title={`Распределение категорий за ${periodLabel.toLowerCase()}`}>
                  <div className="h-[320px]">
                    {errorsPie.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={errorsPie} dataKey="count" nameKey="category" innerRadius={70} outerRadius={110} paddingAngle={4}>
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
                </ChartCard>

                <ChartCard eyebrow="Поток обмена" title="Почасовая динамика успехов и ошибок">
                  <div className="h-[360px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={hourlyTrend}>
                        <CartesianGrid stroke="#d8d6d0" strokeDasharray="3 3" />
                        <XAxis dataKey="hourBucket" tickFormatter={formatHourLabel} stroke="#4d564f" fontSize={12} />
                        <YAxis stroke="#4d564f" fontSize={12} allowDecimals={false} />
                        <Tooltip labelFormatter={(label) => formatDate(String(label))} formatter={(value: number) => value.toLocaleString("ru-RU")} />
                        <Legend />
                        <Line type="monotone" dataKey="successCount" name="Успешно" stroke={SUCCESS_COLOR} strokeWidth={3} dot={false} />
                        <Line type="monotone" dataKey="errorCount" name="Ошибки" stroke={ERROR_COLOR} strokeWidth={3} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>
              </section>

              <section className="mt-8 grid gap-6 xl:grid-cols-[1.15fr_1fr]">
                <ChartCard eyebrow="Проблемные клиники" title={`Топ организаций по ошибкам за ${periodLabel.toLowerCase()}`}>
                  {clinicErrors.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full border-separate border-spacing-y-3">
                        <thead>
                          <tr className="text-left text-sm text-ink/45">
                            <th className="px-4 py-2">Клиника</th>
                            <th className="px-4 py-2">MO UID</th>
                            <th className="px-4 py-2">Ошибок</th>
                            <th className="px-4 py-2">Всего</th>
                            <th className="px-4 py-2">Успешность</th>
                            <th className="px-4 py-2">Последняя ошибка</th>
                          </tr>
                        </thead>
                        <tbody>
                          {clinicErrors.map((row) => (
                            <tr key={row.moUid} className="bg-white text-sm text-ink">
                              <td className="rounded-l-2xl px-4 py-4 font-medium">{row.clinicName}</td>
                              <td className="px-4 py-4 text-ink/70">{row.moUid}</td>
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
                      За выбранный период проблемные организации не выявлены
                    </div>
                  )}
                </ChartCard>

                <ChartCard eyebrow="Состояние сервисов" title={`Ошибки по типам сервисов за ${periodLabel.toLowerCase()}`}>
                  {serviceHealth.length > 0 ? (
                    <div className="h-[360px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={serviceHealth.slice(0, 8)} layout="vertical" margin={{ left: 16, right: 16 }}>
                          <CartesianGrid stroke="#d8d6d0" strokeDasharray="3 3" />
                          <XAxis type="number" stroke="#4d564f" fontSize={12} allowDecimals={false} />
                          <YAxis type="category" dataKey="semdType" stroke="#4d564f" fontSize={12} width={120} />
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

              <section className="mt-8 grid gap-6 xl:grid-cols-2">
                <ChartCard eyebrow="Экономика поддержки" title="Топ клиник по затратам на обработку ошибок">
                  {costlyClinics.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full border-separate border-spacing-y-3">
                        <thead>
                          <tr className="text-left text-sm text-ink/45">
                            <th className="px-4 py-2">Клиника</th>
                            <th className="px-4 py-2">Затраты (руб)</th>
                            <th className="px-4 py-2">Ошибок</th>
                            <th className="px-4 py-2">Приоритет</th>
                          </tr>
                        </thead>
                        <tbody>
                          {costlyClinics.map((row) => (
                            <tr key={row.moUid} className="bg-white text-sm text-ink">
                              <td className="rounded-l-2xl px-4 py-4 font-medium">{row.clinicName || row.clinicDisplayName}</td>
                              <td className="px-4 py-4 font-semibold text-amber-700">{row.totalErrorCost.toFixed(2)}</td>
                              <td className="px-4 py-4 text-rose-700">{row.errorCount.toLocaleString("ru-RU")}</td>
                              <td className="rounded-r-2xl px-4 py-4">
                                <span
                                  className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                                    row.supportPriority === "high"
                                      ? "bg-rose-100 text-rose-700"
                                      : row.supportPriority === "medium"
                                        ? "bg-amber-100 text-amber-700"
                                        : "bg-emerald-100 text-emerald-700"
                                  }`}
                                >
                                  {row.supportPriority === "high" ? "Высокий" : row.supportPriority === "medium" ? "Средний" : "Низкий"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-ink/12 bg-white/60 p-6 text-center text-ink/55">
                      Нет данных по затратам на обработку ошибок
                    </div>
                  )}
                </ChartCard>

                <ChartCard eyebrow="Стабильность инфраструктуры" title={`Статус VPN узлов за ${periodLabel.toLowerCase()}`}>
                  {vpnNodes.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full border-separate border-spacing-y-3">
                        <thead>
                          <tr className="text-left text-sm text-ink/45">
                            <th className="px-4 py-2">Узел</th>
                            <th className="px-4 py-2">Успешность</th>
                            <th className="px-4 py-2">Статус</th>
                            <th className="px-4 py-2">Производительность</th>
                          </tr>
                        </thead>
                        <tbody>
                          {vpnNodes.map((row) => (
                            <tr key={row.hostname} className="bg-white text-sm text-ink">
                              <td className="rounded-l-2xl px-4 py-4 font-medium">{row.hostname}</td>
                              <td className="px-4 py-4">{row.successRatePct.toFixed(2)}%</td>
                              <td className="px-4 py-4">
                                <span
                                  className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                                    row.stabilityStatus === "critical"
                                      ? "bg-rose-100 text-rose-700"
                                      : row.stabilityStatus === "warning"
                                        ? "bg-amber-100 text-amber-700"
                                        : "bg-emerald-100 text-emerald-700"
                                  }`}
                                >
                                  {row.stabilityStatus === "critical" ? "Критичный" : row.stabilityStatus === "warning" ? "Внимание" : "Стабилен"}
                                </span>
                              </td>
                              <td className="rounded-r-2xl px-4 py-4">
                                <span
                                  className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                                    row.performanceStatus === "slow"
                                      ? "bg-amber-100 text-amber-700"
                                      : row.performanceStatus === "normal"
                                        ? "bg-blue-100 text-blue-700"
                                        : "bg-emerald-100 text-emerald-700"
                                  }`}
                                >
                                  {row.performanceStatus === "slow" ? "Медленно" : row.performanceStatus === "normal" ? "Нормально" : "Быстро"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-ink/12 bg-white/60 p-6 text-center text-ink/55">
                      Нет данных по VPN узлам
                    </div>
                  )}
                </ChartCard>
              </section>

              <section className="mt-8">
                <ChartCard eyebrow="Активность клиник" title="Статусы последних обменов">
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-separate border-spacing-y-3">
                      <thead>
                        <tr className="text-left text-sm text-ink/45">
                          <th className="px-4 py-2">Клиника</th>
                          <th className="px-4 py-2">MO UID</th>
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
                              <td className="rounded-l-2xl px-4 py-4 font-medium">{row.clinicDisplayName}</td>
                              <td className="px-4 py-4 text-ink/70">{row.mo_uid}</td>
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
                  </div>
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
