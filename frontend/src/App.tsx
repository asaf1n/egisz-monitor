import { Navigate, Route, Routes } from "react-router-dom";

import Configuration from "./components/config/Configuration";
import Dashboard from "./components/dashboard/Dashboard";

function LegacyDashboardPlaceholder(): JSX.Element {
  return (
    <main className="min-h-screen bg-[#121826] font-mono text-white">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <section className="rounded-2xl bg-[#0F1522] p-8">
          <p className="text-xs uppercase tracking-[0.2em] text-[#4B5563]">legacy</p>
          <h1 className="mt-3 text-3xl font-semibold">Архивный дашборд</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-[#9CA3AF]">
            Этот маршрут сохранен как заглушка для старого сценария. Основной путь сейчас проходит через конфигурацию и Metabase.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <a href="/" className="inline-flex items-center justify-center rounded-lg bg-[#509EE3] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#62A8E7]">
              Вернуться к конфигурации
            </a>
            <a href="/dashboard" className="inline-flex items-center justify-center rounded-lg bg-[#111B2B] px-5 py-3 text-sm font-semibold text-[#D1D5DB] transition hover:text-white">
              Открыть текущий dashboard
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}

function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<Configuration />} />
      <Route path="/legacy-dashboard" element={<LegacyDashboardPlaceholder />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
