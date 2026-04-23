interface ProgressBarProps {
  value: number;
  current: number;
  total: number;
  status: "idle" | "running" | "success" | "failed";
}

function clampPercent(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}

export function ProgressBar({ value, current, total, status }: ProgressBarProps): JSX.Element {
  const normalizedValue = clampPercent(value);
  const fillClass = status === "failed" ? "bg-rose-500" : "bg-[#509EE3]";

  return (
    <div>
      <div className="h-2 overflow-hidden rounded-full bg-[#1A2437]">
        <div className={`h-full rounded-full transition-all duration-500 ${fillClass}`} style={{ width: `${normalizedValue}%` }} />
      </div>
      <div className="mt-2 text-xs text-[#9CA3AF]">
        {"\u041E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u043E"}: {current} {"\u0438\u0437"} {total}{" "}
        {"\u0437\u0430\u043F\u0438\u0441\u0435\u0439"}.
      </div>
    </div>
  );
}
