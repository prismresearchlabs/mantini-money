"use client";

import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, ArrowRight, Inbox } from "lucide-react";

export type DashboardData = Awaited<
  ReturnType<typeof import("@/lib/dashboard").getDashboardData>
>;
export const palette = [
  "#367e6d",
  "#729e94",
  "#8495bd",
  "#d4b37e",
  "#b09ab8",
  "#d29587",
  "#a7b5bf",
  "#c3c9bd",
];
export function money(value: number | null | undefined, cents = false) {
  return value == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: cents ? 2 : 0,
        maximumFractionDigits: cents ? 2 : 0,
      }).format(value);
}
export function compact(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 0,
  }).format(value);
}
export function shortDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric" },
  );
}
export function timestamp(value: string) {
  return new Date(
    /^\d{4}-\d{2}-\d{2} /.test(value) ? `${value.replace(" ", "T")}Z` : value,
  );
}
export function PanelHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="panel-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
export function Metric({
  label,
  value,
  note,
  tone,
  icon,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: string;
  icon?: ReactNode;
}) {
  return (
    <article className="metric">
      <div className="metric-label">
        {label}
        {icon}
      </div>
      <strong>{value}</strong>
      {note && <span className={tone || "muted"}>{note}</span>}
    </article>
  );
}
export function Change({
  value,
  suffix = "vs. previous period",
  invert = false,
}: {
  value: number | null;
  suffix?: string;
  invert?: boolean;
}) {
  if (value === null || !Number.isFinite(value))
    return <span className="muted">No previous-period comparison</span>;
  return (
    <span
      className={`change ${(invert ? value <= 0 : value >= 0) ? "positive" : "negative"}`}
    >
      {value >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{" "}
      {Math.abs(value).toFixed(1)}% <span className="muted">{suffix}</span>
    </span>
  );
}
export function Empty({
  title = "Nothing here yet",
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Inbox size={26} />
      <h3>{title}</h3>
      <p>
        {children || "Try another period or connect an account to get started."}
      </p>
    </div>
  );
}
export function ViewLink({
  href,
  children = "View all",
}: {
  href: string;
  children?: ReactNode;
}) {
  return (
    <a className="text-link" href={href}>
      {children}
      <ArrowRight size={14} />
    </a>
  );
}
export function Segments<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segments" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          className={value === option.value ? "active" : ""}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
