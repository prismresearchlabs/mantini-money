"use client";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { compact, Empty, money, palette } from "./ui";

const tip = {
  background: "#fff",
  border: "1px solid #e7e9ed",
  borderRadius: 12,
  boxShadow: "0 8px 28px #1c302014",
  fontSize: 12,
  color: "#253b36",
};
export function BalanceChart({
  data,
  dataKey = "balance",
  color = "#367e6d",
  label = "Cash balance",
}: {
  data: { date: string; [key: string]: string | number }[];
  dataKey?: string;
  color?: string;
  label?: string;
}) {
  if (!data.length)
    return (
      <Empty title="History is building">
        Your recorded balances will appear here as they become available.
      </Empty>
    );
  return (
    <div
      className="chart-box"
      role="img"
      aria-label={`${label} history, ${data.length} recorded points`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 15, right: 12, bottom: 0, left: -12 }}
        >
          <defs>
            <linearGradient id={`fill-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.2} />
              <stop offset="100%" stopColor={color} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="#e9edeb"
            strokeDasharray="3 5"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            minTickGap={50}
            tick={{ fill: "#8a9498", fontSize: 11 }}
            dy={8}
          />
          <YAxis
            tickFormatter={compact}
            width={64}
            domain={["auto", "auto"]}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#8a9498", fontSize: 11 }}
          />
          <Tooltip
            contentStyle={tip}
            formatter={(value) => [money(Number(value), true), label]}
          />
          <Area
            isAnimationActive={false}
            type="monotone"
            dataKey={dataKey}
            name={label}
            stroke={color}
            strokeWidth={2.5}
            fill={`url(#fill-${dataKey})`}
            dot={data.length === 1 ? { r: 5 } : false}
            activeDot={{ r: 5, stroke: "white", strokeWidth: 3 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
export function MonthlyChart({
  data,
  spendingOnly = false,
}: {
  data: {
    key: string;
    label: string;
    income: number;
    spending: number;
    net: number;
  }[];
  spendingOnly?: boolean;
}) {
  if (!data.length) return <Empty title="No activity in this period" />;
  return (
    <div
      className="chart-box"
      role="img"
      aria-label={
        spendingOnly ? "Monthly spending" : "Monthly income and spending"
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          barGap={5}
          margin={{ top: 12, right: 10, bottom: 0, left: -10 }}
        >
          <CartesianGrid
            vertical={false}
            stroke="#e9edeb"
            strokeDasharray="3 5"
          />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#8a9498", fontSize: 11 }}
            dy={8}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tickFormatter={compact}
            width={62}
            tick={{ fill: "#8a9498", fontSize: 11 }}
          />
          <Tooltip
            contentStyle={tip}
            cursor={{ fill: "#f4f7f6" }}
            formatter={(value, name) => [money(Number(value), true), name]}
          />
          {!spendingOnly && (
            <Bar
              isAnimationActive={false}
              dataKey="income"
              name="Income"
              fill="#367e6d"
              radius={[5, 5, 0, 0]}
              maxBarSize={40}
            />
          )}
          <Bar
            isAnimationActive={false}
            dataKey="spending"
            name="Spending"
            fill={spendingOnly ? "#8495bd" : "#b9c8c3"}
            radius={[5, 5, 0, 0]}
            maxBarSize={40}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
export type BreakdownItem = {
  name: string;
  value: number;
  color?: string;
  percent?: number;
  count?: number;
};
export function Donut({
  data,
  total,
  label = "Total spending",
}: {
  data: BreakdownItem[];
  total: number;
  label?: string;
}) {
  if (!total || !data.length)
    return (
      <Empty
        title={
          label === "Total spending"
            ? "No spending yet"
            : "No connected value yet"
        }
      />
    );
  return (
    <div className="donut-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            isAnimationActive={false}
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius="72%"
            outerRadius="92%"
            paddingAngle={2}
            stroke="none"
            startAngle={90}
            endAngle={-270}
          >
            {data.map((item, index) => (
              <Cell
                key={item.name}
                fill={item.color || palette[index % palette.length]}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={tip}
            formatter={(value) => money(Number(value), true)}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="donut-center">
        <span>{label}</span>
        <strong>{money(total)}</strong>
      </div>
    </div>
  );
}
export function Breakdown({
  data,
  onSelect,
  limit,
}: {
  data: BreakdownItem[];
  onSelect?: (name: string) => void;
  limit?: number;
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (!data.length) return <Empty title="No activity to break down" />;
  return (
    <div className="breakdown-list">
      {data.slice(0, limit).map((item, i) => (
        <button
          className="breakdown-item"
          key={item.name}
          disabled={!onSelect}
          onClick={() => onSelect?.(item.name)}
        >
          <div className="breakdown-line">
            <span>
              <i
                style={{
                  background: item.color || palette[i % palette.length],
                }}
              />
              {item.name}
            </span>
            <strong>
              {money(item.value)}
              <small>
                {(total ? (item.value / total) * 100 : 0).toFixed(1)}%
              </small>
            </strong>
          </div>
          <div className="mini-track">
            <i
              style={{
                width: `${total ? (item.value / total) * 100 : 0}%`,
                background: item.color || palette[i % palette.length],
              }}
            />
          </div>
        </button>
      ))}
    </div>
  );
}
export function FlowDiagram({
  income,
  refunds,
  spending,
  taxes,
  invested,
  saved,
  categories,
}: {
  income: number;
  refunds: number;
  spending: number;
  taxes: number;
  invested: number;
  saved: number;
  categories: BreakdownItem[];
}) {
  const out = spending + taxes + invested + saved;
  const available = income + refunds;
  const total = Math.max(out, available);
  if (!total)
    return (
      <Empty title="Your money story starts here">
        Posted income and expenses will build your cash-flow picture.
      </Empty>
    );
  const top = categories.slice(0, 5);
  const other = spending - top.reduce((s, x) => s + x.value, 0);
  const destinations = [
    ...top,
    ...(other > 0.01
      ? [{ name: "Other spending", value: other, color: "#acb6bf" }]
      : []),
    { name: "Taxes", value: taxes, color: "#d29587" },
    { name: "Invested", value: invested, color: "#8495bd" },
    { name: "Savings / tax reserve", value: saved, color: "#729e94" },
    {
      name: "Remaining",
      value: Math.max(0, available - out),
      color: "#367e6d",
    },
  ].filter((x) => x.value > 0);
  const sources = [
    { name: "Income", value: income },
    { name: "Refunds", value: refunds },
    { name: "Balance funding", value: Math.max(0, out - available) },
  ].filter((x) => x.value > 0);
  const h = Math.max(320, destinations.length * 46);
  const scale =
    (h - Math.max((destinations.length - 1) * 34, (sources.length - 1) * 34)) /
    total;
  const centerY = (h - total * scale) / 2;
  let sourceY = (h - total * scale - (sources.length - 1) * 34) / 2,
    targetY = 0,
    centerIn = centerY,
    centerOut = centerY;
  return (
    <div className="flow-diagram">
      <svg
        viewBox={`0 0 950 ${h + 28}`}
        role="img"
        aria-label={`Income ${money(income)} flowing to ${money(out)} in outflows and ${money(Math.max(0, available - out))} remaining`}
      >
        {sources.map((source) => {
          const size = source.value * scale;
          const y = sourceY;
          sourceY += size + 34;
          const cy = centerIn;
          centerIn += size;
          return (
            <g key={source.name}>
              <path
                d={`M175,${y + 12} C290,${y + 12} 320,${cy + 12} 440,${cy + 12} L440,${cy + size + 12} C320,${cy + size + 12} 290,${y + size + 12} 175,${y + size + 12} Z`}
                fill={source.name === "Balance funding" ? "#d29587" : "#70ad99"}
                opacity=".27"
              />
              <rect
                x="168"
                y={y + 12}
                width="7"
                height={Math.max(size, 2)}
                fill={source.name === "Balance funding" ? "#d29587" : "#367e6d"}
                rx="3"
              />
              <text
                x="155"
                y={y + size / 2 + 8}
                textAnchor="end"
                className="flow-name"
              >
                {source.name}
              </text>
              <text
                x="155"
                y={y + size / 2 + 26}
                textAnchor="end"
                className="flow-value"
              >
                {money(source.value)}
              </text>
            </g>
          );
        })}
        <rect
          x="440"
          y={centerY + 12}
          width="8"
          height={total * scale}
          rx="3"
          fill="#367e6d"
        />
        {destinations.map((dest, i) => {
          const size = dest.value * scale;
          const y = targetY;
          targetY += size + 34;
          const cy = centerOut;
          centerOut += size;
          const c = dest.color || palette[i % palette.length];
          return (
            <g key={dest.name}>
              <path
                d={`M448,${cy + 12} C570,${cy + 12} 590,${y + 12} 722,${y + 12} L722,${y + size + 12} C590,${y + size + 12} 570,${cy + size + 12} 448,${cy + size + 12} Z`}
                fill={c}
                opacity=".28"
              />
              <rect
                x="722"
                y={y + 12}
                width="7"
                height={Math.max(2, size)}
                fill={c}
                rx="3"
              />
              <text x="743" y={y + size / 2 + 8} className="flow-name">
                {dest.name}
              </text>
              <text x="743" y={y + size / 2 + 26} className="flow-value">
                {money(dest.value)} · {((dest.value / total) * 100).toFixed(1)}%
              </text>
              <title>
                {dest.name}: {money(dest.value, true)}
              </title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
