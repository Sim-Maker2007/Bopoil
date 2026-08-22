import { toCsv } from "../../../../lib/accounting";
import { GET as report } from "../route";

type Report = { range: { from: string; to: string }; location: { name: string; currency: string }; metrics: Record<string, number>; staffPerformance: Array<Record<string, string | number>>; servicePerformance: Array<Record<string, string | number>>; locationComparison: Array<Record<string, string | number>>; error?: string };

export async function GET(request: Request) {
  const response = await report(request); if (!response.ok) return response; const data = await response.json() as Report;
  const rows: unknown[][] = [
    ["section", "name", "metric", "value", "currency", "period_start", "period_end"],
    ...Object.entries(data.metrics).map(([metric, value]) => ["summary", data.location.name, metric, value, data.location.currency, data.range.from, data.range.to]),
    ...data.staffPerformance.flatMap((item) => Object.entries(item).filter(([key]) => key !== "key" && key !== "label").map(([metric, value]) => ["staff", item.label, metric, value, data.location.currency, data.range.from, data.range.to])),
    ...data.servicePerformance.flatMap((item) => Object.entries(item).filter(([key]) => key !== "key" && key !== "label").map(([metric, value]) => ["service", item.label, metric, value, data.location.currency, data.range.from, data.range.to])),
    ...data.locationComparison.flatMap((item) => Object.entries(item).filter(([key]) => !["id", "name", "currency"].includes(key)).map(([metric, value]) => ["location", item.name, metric, value, item.currency, data.range.from, data.range.to])),
  ];
  return new Response(toCsv(rows[0] as string[], rows.slice(1)), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="owner-intelligence-${data.range.from}-${data.range.to}.csv"`, "cache-control": "private, no-store" } });
}
