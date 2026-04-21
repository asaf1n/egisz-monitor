import { NavLink, Navigate, Route, Routes } from "react-router-dom";

import Configuration from "./components/config/Configuration";
import Dashboard from "./components/dashboard/Dashboard";

function Navigation(): JSX.Element {
  const getLinkClassName = ({ isActive }: { isActive: boolean }): string =>
    `rounded-full px-4 py-2 text-sm font-medium transition ${
      isActive ? "bg-moss text-white shadow-sm" : "text-ink/65 hover:bg-moss/8 hover:text-ink"
    }`;

  return (
    <header className="sticky top-0 z-10 border-b border-ink/8 bg-white/92 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-ink/35">EGISZ Monitor</p>
          <p className="mt-1 text-lg font-semibold text-ink">Панель аналитики и настроек</p>
        </div>

        <nav className="flex items-center gap-2 rounded-full border border-ink/8 bg-canvas/75 p-1">
          <NavLink to="/" end className={getLinkClassName}>
            Дашборд
          </NavLink>
          <NavLink to="/settings" className={getLinkClassName}>
            Настройки
          </NavLink>
        </nav>
      </div>
    </header>
  );
}

function App(): JSX.Element {
  return (
    <>
      <Navigation />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/settings" element={<Configuration />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default App;
