import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AXIS_TICK, BRAND, ChartCard, MUTED_BAR, TooltipCard } from './chartTheme.jsx';

const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

// The API buckets hours in UTC. Each bucket keeps its exact local start time (so a +05:30 zone shows
// 05:30, 06:30...) instead of being rounded onto the wrong clock hour.
function toLocalRows(busiestHours) {
  const shiftMin = -new Date().getTimezoneOffset();
  return busiestHours
    .map(({ hour, total }) => {
      const start = (((hour * 60 + shiftMin) % 1440) + 1440) % 1440;
      return { start, label: clock(start), total };
    })
    .sort((a, b) => a.start - b.start);
}

export function BusiestHoursCard({ busiestHours }) {
  const rows = toLocalRows(busiestHours);
  const peak = rows.reduce((best, r) => (r.total > best.total ? r : best), rows[0]);
  const hasPeak = peak.total > 0;

  return (
    <ChartCard
      title="Busiest hours"
      hint={hasPeak ? `Peak around ${peak.label} your time. Totals by hour of day across the period.` : 'Totals by hour of day (your time).'}
    >
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap={2}>
            <XAxis
              dataKey="label"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              interval={0}
              tickFormatter={(label, index) => (index % 6 === 0 ? label : '')}
            />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: 'var(--brand-soft)' }}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <TooltipCard title={`${payload[0].payload.label} – ${clock((payload[0].payload.start + 60) % 1440)}`} rows={[{ label: 'Requests', value: payload[0].value }]} />
                ) : null
              }
            />
            <Bar dataKey="total" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {rows.map((r) => (
                <Cell key={r.start} fill={hasPeak && r.start === peak.start ? BRAND : MUTED_BAR} fillOpacity={hasPeak && r.start === peak.start ? 1 : 0.45} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
