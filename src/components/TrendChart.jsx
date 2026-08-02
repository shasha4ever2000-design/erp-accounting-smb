import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'

// The dashboard's area charts, in their own module so the charting library can
// be code-split away from the first paint.
//
// The dashboard is the one page loaded eagerly — it is where everybody lands —
// and it imported recharts directly, which put 404 KB (111 KB gzipped) of
// charting into the entry bundle. Everybody downloaded it before they saw
// anything, to draw two graphs below the fold. Lazily loading this file moves
// the whole library out of that path.
//
// Kept deliberately dumb: the page computes the data, this draws it.

/**
 * @param {object[]} data     rows keyed by `xKey`
 * @param {object[]} series   [{ key, stroke, fillOpacity, gradientId }]
 * @param {object}   theme    { dark, gridStroke, tickFill, tooltipStyle }
 */
export default function TrendChart({
  data = [], series = [], xKey = 'month', height = 220,
  formatValue = (v) => v, formatAxis = (v) => v, theme = {},
}) {
  const { dark = false, gridStroke = '#eef2f7', tickFill = '#6b7280', tooltipStyle = {} } = theme
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.gradientId} id={s.gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={s.stroke} stopOpacity={s.fillOpacity ?? 0.22} />
              <stop offset="95%" stopColor={s.stroke} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
        <XAxis dataKey={xKey} tick={{ fontSize: 12, fill: tickFill }} axisLine={false} tickLine={false} dy={4} />
        <YAxis tick={{ fontSize: 11, fill: tickFill }} axisLine={false} tickLine={false} tickFormatter={formatAxis} width={72} />
        <Tooltip formatter={formatValue} {...tooltipStyle} />
        {series.map((s) => (
          <Area key={s.key} type="monotone" dataKey={s.key} stroke={s.stroke}
            fill={`url(#${s.gradientId})`} strokeWidth={2.25} dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: dark ? '#0f172a' : '#fff' }} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  )
}
