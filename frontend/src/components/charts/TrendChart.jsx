import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDate } from '@/lib/format';
export function TrendChart({ data, color = 'var(--color-accent)', unit = '', height = 220 }) {
    return (<ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.32}/>
            <stop offset="100%" stopColor={color} stopOpacity={0}/>
          </linearGradient>
        </defs>
        <XAxis dataKey="date" tickFormatter={(v) => formatDate(v)} tick={{ fill: 'var(--color-text-faint)', fontSize: 11 }} axisLine={{ stroke: 'var(--color-border)' }} tickLine={false} minTickGap={24}/>
        <YAxis tick={{ fill: 'var(--color-text-faint)', fontSize: 11 }} axisLine={false} tickLine={false} width={36}/>
        <Tooltip contentStyle={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-strong)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--color-text)',
        }} labelFormatter={(v) => formatDate(String(v))} formatter={(value) => [`${value ?? ''}${unit}`, '']}/>
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill="url(#trendFill)" activeDot={{ r: 4 }}/>
      </AreaChart>
    </ResponsiveContainer>);
}
