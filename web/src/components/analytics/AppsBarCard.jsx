import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AXIS_TICK, BRAND, ChartCard, MUTED_BAR, TooltipCard, formatCount } from './chartTheme.jsx';

const ROW_HEIGHT = 34;

export function AppsBarCard({ apps }) {
  const rows = apps.map((a) => ({ id: a.id, name: a.name, total: a.total }));
  const height = Math.max(120, rows.length * ROW_HEIGHT + 16);

  return (
    <ChartCard title="Requests by app" hint="Ranked by request count. Apps without traffic are listed with 0.">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }} barCategoryGap={6}>
            <XAxis type="number" hide domain={[0, 'dataMax']} />
            <YAxis
              type="category"
              dataKey="name"
              width={110}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              interval={0}
              tickFormatter={(v) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)}
            />
            <Tooltip
              cursor={{ fill: 'var(--brand-soft)' }}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <TooltipCard rows={[{ label: payload[0].payload.name, value: payload[0].value }]} />
                ) : null
              }
            />
            <Bar dataKey="total" radius={[0, 6, 6, 0]} minPointSize={2} isAnimationActive={false}>
              {rows.map((row, i) => (
                <Cell key={row.id} fill={i === 0 && row.total > 0 ? BRAND : MUTED_BAR} fillOpacity={i === 0 && row.total > 0 ? 1 : 0.45} />
              ))}
              <LabelList dataKey="total" position="right" formatter={formatCount} style={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
