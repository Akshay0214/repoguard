import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts';
import { CATEGORY_META } from '@/lib/meta';
import type { DebtCategoryBreakdown } from '@/types';

const COLORS = ['#e8a33d', '#4fa8e8', '#3ec98a', '#ef4b4b', '#a78bfa'];

export function CategoryBarChart({ data, height = 240 }: { data: DebtCategoryBreakdown[]; height?: number }) {
  const chartData = data.map((d) => ({
    name: CATEGORY_META[d.category].label,
    hours: d.hours,
    percent: d.percent,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 4 }}>
        <CartesianGrid horizontal={false} stroke="var(--color-border)" />
        <XAxis type="number" tick={{ fill: 'var(--color-text-faint)', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={92}
        />
        <Tooltip
          cursor={{ fill: 'var(--color-surface-2)' }}
          contentStyle={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-strong)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--color-text)',
          }}
          formatter={(value) => [`${value}h`, 'Debt']}
        />
        <Bar dataKey="hours" radius={[0, 4, 4, 0]} barSize={16}>
          {chartData.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
