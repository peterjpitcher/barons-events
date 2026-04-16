import type { CampaignStats } from "@/lib/sms-campaign";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const WAVE_LABELS: Record<number, string> = {
  1: "Wave 1 (14 days)",
  2: "Wave 2 (7 days)",
  3: "Wave 3 (1 day)",
};

interface SmsCampaignStatsProps {
  stats: CampaignStats[];
}

export function SmsCampaignStats({ stats }: SmsCampaignStatsProps): React.ReactElement | null {
  if (stats.length === 0) return null;

  const totalSent = stats.reduce((sum, s) => sum + s.sent, 0);
  const totalFailed = stats.reduce((sum, s) => sum + s.failed, 0);
  const totalConverted = stats.reduce((sum, s) => sum + s.converted, 0);
  const conversionRate =
    totalSent > 0 ? ((totalConverted / totalSent) * 100).toFixed(1) : "0.0";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[var(--color-primary-700)]">
          SMS Campaign
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs font-semibold uppercase tracking-[0.14em] text-subtle">
                <th scope="col" className="px-4 py-2">
                  Wave
                </th>
                <th scope="col" className="px-4 py-2 text-right">
                  Sent
                </th>
                <th scope="col" className="px-4 py-2 text-right">
                  Failed
                </th>
                <th scope="col" className="px-4 py-2 text-right">
                  Booked
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr
                  key={s.wave}
                  className="border-b border-[var(--color-border)] text-[var(--color-text)]"
                >
                  <td className="px-4 py-2 font-medium">
                    {WAVE_LABELS[s.wave] ?? `Wave ${s.wave}`}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {s.sent}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {s.failed}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {s.converted}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Summary */}
        <div className="mt-4 flex flex-wrap gap-6 border-t border-[var(--color-border)] pt-4 text-sm">
          <div>
            <span className="font-semibold text-[var(--color-text)]">Total sent: </span>
            <span className="text-[var(--color-text)]">{totalSent}</span>
          </div>
          <div>
            <span className="font-semibold text-[var(--color-text)]">Total failed: </span>
            <span className="text-subtle">{totalFailed}</span>
          </div>
          <div>
            <span className="font-semibold text-[var(--color-text)]">Conversions: </span>
            <span className="text-[var(--color-text)]">{totalConverted}</span>
          </div>
          <div>
            <span className="font-semibold text-[var(--color-text)]">Conversion rate: </span>
            <span className="text-[var(--color-text)]">{conversionRate}%</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
