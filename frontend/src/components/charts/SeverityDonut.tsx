import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { SEVERITY_META, SEVERITY_ORDER } from '@/lib/meta';
import type { SeverityCounts } from '@/types';

export function SeverityDonut({ counts, size = 160 }: { counts: SeverityCounts; size?: number }) {
  const data = SEVERITY_ORDER.map((sev) => ({
    name: SEVERITY_META[sev].label,
    value: counts[sev],
    color: SEVERITY_META[sev].color,
  }));
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={size * 0.32}
            outerRadius={size * 0.48}
            paddingAngle={3}
            stroke="none"
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border-strong)',
              borderRadius: 8,
              fontSize: 12,
              color: 'var(--color-text)',
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-xl font-semibold text-[var(--color-text)]">{total}</span>
        <span className="text-[10px] text-[var(--color-text-faint)]">issues</span>
      </div>
    </div>
  );
}
