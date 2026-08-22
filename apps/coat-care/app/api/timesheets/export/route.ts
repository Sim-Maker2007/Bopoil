import { and, asc, eq } from "drizzle-orm";
import { staff, timesheetShifts, timesheetWeeks } from "../../../../db/schema";
import { requireSalonAccess, requireSalonManager, requireWorkspacePermission, salonApiError, SalonAccessError } from "../../../salon-access";

function minutes(start: string, end: string) { const [sh, sm] = start.split(":").map(Number); const [eh, em] = end.split(":").map(Number); return eh * 60 + em - sh * 60 - sm; }
function addDays(value: string, amount: number) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10); }
function csv(value: unknown) { const text = String(value ?? ""); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function ascii(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, ""); }
function pdfEscape(value: string) { return ascii(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)"); }
function simplePdf(lines: Array<{ text: string; bold?: boolean; size?: number }>) {
  let y = 760; const commands = ["BT"];
  for (const line of lines) { const size = line.size || 10; commands.push(`/${line.bold ? "F2" : "F1"} ${size} Tf`, `1 0 0 1 48 ${y} Tm`, `(${pdfEscape(line.text)}) Tj`); y -= size + 7; }
  commands.push("ET"); const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let output = "%PDF-1.4\n"; const offsets = [0]; objects.forEach((object, index) => { offsets.push(output.length); output += `${index + 1} 0 obj\n${object}\nendobj\n`; }); const xref = output.length; output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`; for (let index = 1; index <= objects.length; index += 1) output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`; output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(output);
}

export async function GET(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireWorkspacePermission(membership, "workforce"); requireSalonManager(membership); const url = new URL(request.url); const weekId = url.searchParams.get("weekId") || ""; const format = url.searchParams.get("format") === "pdf" ? "pdf" : "csv";
    const [week] = await db.select().from(timesheetWeeks).where(and(eq(timesheetWeeks.id, weekId), eq(timesheetWeeks.organizationId, membership.organizationId))).limit(1); if (!week) throw new SalonAccessError("Feuille introuvable.", 404);
    const [person] = await db.select({ displayName: staff.displayName }).from(staff).where(and(eq(staff.id, week.staffId), eq(staff.organizationId, membership.organizationId))).limit(1); const shifts = await db.select().from(timesheetShifts).where(and(eq(timesheetShifts.weekId, week.id), eq(timesheetShifts.organizationId, membership.organizationId))).orderBy(asc(timesheetShifts.workDate), asc(timesheetShifts.startTime));
    const totalMinutes = shifts.reduce((sum, shift) => sum + minutes(shift.startTime, shift.endTime), 0); const totalTips = shifts.reduce((sum, shift) => sum + shift.tipsCents, 0); const filename = `feuille-${week.weekStartsOn}-${(person?.displayName || "employe").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    if (format === "csv") { const rows = [["Employé", "Semaine", "Date", "Emplacement", "Début", "Fin", "Heures", "Pourboires (CAD)", "Statut"], ...shifts.map((shift) => [person?.displayName || "Employé", week.weekStartsOn, shift.workDate, shift.locationName, shift.startTime, shift.endTime, (minutes(shift.startTime, shift.endTime) / 60).toFixed(2), (shift.tipsCents / 100).toFixed(2), week.status]), ["TOTAL", week.weekStartsOn, "", "", "", "", (totalMinutes / 60).toFixed(2), (totalTips / 100).toFixed(2), week.status]]; return new Response(`\uFEFF${rows.map((row) => row.map(csv).join(",")).join("\r\n")}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}.csv"`, "cache-control": "no-store" } }); }
    const lines: Array<{ text: string; bold?: boolean; size?: number }> = [{ text: "COAT & CARE - FEUILLE DE TEMPS", bold: true, size: 18 }, { text: `Employe : ${person?.displayName || "Employe"}`, bold: true, size: 12 }, { text: `Semaine du ${week.weekStartsOn} au ${addDays(week.weekStartsOn, 5)} | Statut : ${week.status}`, size: 9 }, { text: "", size: 5 }, { text: "Date       Emplacement           Debut   Fin     Heures   Pourboires", bold: true, size: 9 }, ...shifts.map((shift) => ({ text: `${shift.workDate}  ${shift.locationName.padEnd(20).slice(0, 20)}  ${shift.startTime}   ${shift.endTime}   ${(minutes(shift.startTime, shift.endTime) / 60).toFixed(2).padStart(6)} h   $${(shift.tipsCents / 100).toFixed(2)}`, size: 9 })), { text: "", size: 5 }, { text: `TOTAL : ${(totalMinutes / 60).toFixed(2)} heures | Pourboires : $${(totalTips / 100).toFixed(2)} CAD`, bold: true, size: 12 }, { text: week.submittedAt ? `Soumise le ${new Date(week.submittedAt).toLocaleString("fr-CA", { timeZone: "America/Toronto" })}` : "Brouillon non soumis", size: 9 }];
    return new Response(simplePdf(lines), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${filename}.pdf"`, "cache-control": "no-store" } });
  } catch (error) { return salonApiError(error, "L’export n’a pas pu être créé."); }
}
