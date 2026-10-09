import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AXIS_TICK, ChartCard, GRID_STROKE, TooltipCard, appColor, formatBucket } from './chartTheme.jsx';

const MAX_LINES = 8;

export function TimeSeriesCard({ data }) {
  // Colours follow the ranking in `apps`, so an app keeps its colour whatever the selection.
  const lines = data.apps.map((app, i) => ({ ...app, color: appColor(i) })).filter((a) => a.total > 0).slice(0, MAX_LINES);
  const hidden = data.apps.filter((a) => a.total > 0).length - lines.length;
  const rows = data.series.map((point) => ({ t: point.t, ...point.perApp }));
  const unit = data.bucket === 'day' ? 'per day (UTC)' : 'per hour';

  return (
    <ChartCard
      title="Requests over time"
      hint={`Requests ${unit}${hidden > 0 ? `, top ${MAX_LINES} apps shown` : ''}.`}
      className="lg:col-span-2"
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="t"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: GRID_STROKE }}
              tickFormatter={(v) => formatBucket(v, data.bucket)}
              minTickGap={24}
            />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
            <Tooltip
              cursor={{ stroke: GRID_STROKE }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipCard
                    title={formatBucket(label, data.bucket, true)}
                    rows={[...payload]
                      .sort((a, b) => b.value - a.value)
                      .map((p) => ({ label: lines.find((l) => l.id === p.dataKey)?.name ?? p.dataKey, value: p.value, color: p.stroke }))}
                  />
                ) : null
              }
            />
            {lines.map((line) => (
              <Line
                key={line.id}
                type="monotone"
                dataKey={line.id}
                stroke={line.color}
                strokeWidth={2}
                dot={rows.length <= 2}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-[var(--text-secondary)]">
        {lines.map((line) => (
          <li key={line.id} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: line.color }} />
            {line.name}
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}
