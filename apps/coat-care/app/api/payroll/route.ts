import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { appointments, auditEvents, compensationProfiles, invoiceLineItems, locations, paymentEvents, payrollLines, payrollPeriods, staff, staffLocations, timeEntries, timeEntryAdjustments, timesheetShifts, timesheetWeeks } from "../../../db/schema";
import { requirePayrollAccess, requirePayrollManagement, requireSalonAccess, salonApiError, SalonAccessError } from "../../salon-access";
import { calculateGross, calculateRetailCommission, CompensationSnapshot, mergeReportedTips, PAYROLL_DISCLAIMER, splitCommissionRevenue, splitWeeklyMinutes } from "../../../lib/payroll";
import { zonedDayBounds } from "../../../lib/time-zone";

import { databaseErrorMessage } from "../../../db";
function date(value: unknown, name: string) {
  const result = String(value || "");
  const parsed = new Date(`${result}T12:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) throw new SalonAccessError(`${name} is invalid`, 400);
  return result;
}

function periodBounds(startsOn: string, endsOn: string, timeZone: string) {
  return { start: zonedDayBounds(startsOn, timeZone).start.toISOString(), end: zonedDayBounds(endsOn, timeZone).end.toISOString() };
}

function signedServicePrincipal(payment: { kind: string; amountCents: number; taxAmountCents: number; tipAmountCents: number }) {
  const principal = Math.max(0, payment.amountCents - payment.taxAmountCents - payment.tipAmountCents);
  return payment.kind === "refund" ? -principal : principal;
}

type PayrollDb = ReturnType<typeof import("../../../db").getDb>;
type SnapshotValue = string | number | null;
type SnapshotComponent = { rows: SnapshotValue[][]; signature: string };
type PayrollInputSnapshot = {
  version: 1;
  location: SnapshotComponent;
  team: SnapshotComponent;
  compensationProfiles: SnapshotComponent;
  approvedTime: SnapshotComponent;
  approvedReportedTips: SnapshotComponent;
  payments: SnapshotComponent;
  invoiceLines: SnapshotComponent;
  appointmentAssignments: SnapshotComponent;
};

function snapshotComponent(rows: SnapshotValue[][]): SnapshotComponent {
  // Tri par unités de code, pas localeCompare : le SQL de garde reproduit cet
  // ordre avec COLLATE "C", qui ne dépend pas de la locale du serveur Postgres.
  const sorted = [...rows].sort((left, right) => {
    const a = String(left[0]), b = String(right[0]);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return { rows: sorted, signature: sorted.map((row) => JSON.stringify(row)).join("|") };
}

// Reconstruit en SQL le JSON.stringify(row) de snapshotComponent, octet pour
// octet : to_json() applique les mêmes échappements JSON que JavaScript et
// coalesce(..., 'null') reproduit la sérialisation des valeurs null.
function jsonRowSql(fields: string[]) {
  return `('[' || ${fields.map((field) => `coalesce(to_json(${field})::text, 'null')`).join(" || ',' || ")} || ']')`;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadPayrollInputs(db: PayrollDb, input: {
  organizationId: string;
  locationId: string;
  startsOn: string;
  endsOn: string;
}) {
  const [location] = await db.select({
    id: locations.id,
    name: locations.name,
    currency: locations.currency,
    timezone: locations.timezone,
  }).from(locations).where(and(
    eq(locations.id, input.locationId),
    eq(locations.organizationId, input.organizationId),
    eq(locations.active, true),
  )).limit(1);
  if (!location) throw new SalonAccessError("Payroll location not found.", 404);

  const bounds = periodBounds(input.startsOn, input.endsOn, location.timezone);
  const sameNameLocations = await db.select({ id: locations.id }).from(locations).where(and(
    eq(locations.organizationId, input.organizationId),
    eq(locations.name, location.name),
  ));
  const allowLegacyLocationName = sameNameLocations.length === 1;
  const shiftLocationCondition = allowLegacyLocationName
    ? or(eq(timesheetShifts.locationId, input.locationId), and(isNull(timesheetShifts.locationId), eq(timesheetShifts.locationName, location.name)))
    : eq(timesheetShifts.locationId, input.locationId);

  if (!allowLegacyLocationName) {
    const ambiguousLegacyShift = await db.select({ id: timesheetShifts.id }).from(timesheetShifts).innerJoin(
      timesheetWeeks,
      and(eq(timesheetShifts.weekId, timesheetWeeks.id), eq(timesheetShifts.organizationId, timesheetWeeks.organizationId)),
    ).where(and(
      eq(timesheetShifts.organizationId, input.organizationId),
      isNull(timesheetShifts.locationId),
      eq(timesheetShifts.locationName, location.name),
      gte(timesheetShifts.workDate, input.startsOn),
      lte(timesheetShifts.workDate, input.endsOn),
      inArray(timesheetWeeks.status, ["submitted", "approved"]),
    )).limit(1);
    if (ambiguousLegacyShift.length) throw new SalonAccessError("Re-select the location on legacy timesheets before building payroll.", 409);
  }

  const team = await db.select({
    assignmentId: staffLocations.id,
    id: staff.id,
    displayName: staff.displayName,
  }).from(staffLocations).innerJoin(staff, eq(staffLocations.staffId, staff.id)).where(and(
    eq(staffLocations.organizationId, input.organizationId),
    eq(staffLocations.locationId, input.locationId),
    eq(staffLocations.active, true),
    eq(staff.organizationId, input.organizationId),
    eq(staff.active, true),
  ));
  const adjustments = await db.select().from(timeEntryAdjustments).where(and(
    eq(timeEntryAdjustments.organizationId, input.organizationId),
    eq(timeEntryAdjustments.locationId, input.locationId),
  )).orderBy(asc(timeEntryAdjustments.createdAt), asc(timeEntryAdjustments.id));
  const latest = new Map(adjustments.map((item) => [item.timeEntryId, item]));
  const effectiveClockInSql = sql<string>`coalesce((
    select candidate_adjustment.clock_in
    from time_entry_adjustments as candidate_adjustment
    where candidate_adjustment.organization_id = ${input.organizationId}
      and candidate_adjustment.location_id = ${input.locationId}
      and candidate_adjustment.time_entry_id = ${timeEntries.id}
    order by candidate_adjustment.created_at desc, candidate_adjustment.id desc
    limit 1
  ), ${timeEntries.clockIn})`;
  const pendingPunches = await db.select({ id: timeEntries.id }).from(timeEntries).where(and(
    eq(timeEntries.organizationId, input.organizationId),
    eq(timeEntries.locationId, input.locationId),
    or(
      and(eq(timeEntries.status, "open"), lt(timeEntries.clockIn, bounds.end)),
      and(eq(timeEntries.status, "submitted"), gte(effectiveClockInSql, bounds.start), lt(effectiveClockInSql, bounds.end)),
    ),
  )).limit(1);
  if (pendingPunches.length) throw new SalonAccessError("Clock out and approve or reject every pending punch before building payroll.", 409);
  const pendingWeeklyShifts = await db.select({ id: timesheetShifts.id }).from(timesheetShifts).innerJoin(
    timesheetWeeks,
    and(eq(timesheetShifts.weekId, timesheetWeeks.id), eq(timesheetShifts.organizationId, timesheetWeeks.organizationId)),
  ).where(and(
    eq(timesheetShifts.organizationId, input.organizationId),
    eq(timesheetWeeks.status, "submitted"),
    shiftLocationCondition,
    gte(timesheetShifts.workDate, input.startsOn),
    lte(timesheetShifts.workDate, input.endsOn),
  )).limit(1);
  if (pendingWeeklyShifts.length) throw new SalonAccessError("Approve submitted weekly sheets before building payroll.", 409);

  const profiles = await db.select().from(compensationProfiles).where(and(
    eq(compensationProfiles.organizationId, input.organizationId),
    eq(compensationProfiles.locationId, input.locationId),
    lte(compensationProfiles.effectiveFrom, input.endsOn),
  )).orderBy(desc(compensationProfiles.effectiveFrom));
  const entries = await db.select().from(timeEntries).where(and(
    eq(timeEntries.organizationId, input.organizationId),
    eq(timeEntries.locationId, input.locationId),
    eq(timeEntries.status, "approved"),
    gte(effectiveClockInSql, bounds.start),
    lt(effectiveClockInSql, bounds.end),
  ));
  const effectiveEntries = entries.map((entry) => {
    const adjustment = latest.get(entry.id);
    return {
      ...entry,
      effectiveClockIn: adjustment?.clockIn || entry.clockIn,
      effectiveClockOut: adjustment?.clockOut || entry.clockOut,
      effectiveBreakMinutes: adjustment?.breakMinutes ?? entry.breakMinutes,
    };
  }).filter((entry) => entry.effectiveClockIn >= bounds.start && entry.effectiveClockIn < bounds.end);
  const payments = await db.select().from(paymentEvents).where(and(
    eq(paymentEvents.organizationId, input.organizationId),
    eq(paymentEvents.locationId, input.locationId),
    eq(paymentEvents.status, "succeeded"),
    gte(paymentEvents.occurredAt, bounds.start),
    lt(paymentEvents.occurredAt, bounds.end),
  ));
  const invoiceIds = [...new Set(payments.map((payment) => payment.invoiceId))];
  const appointmentIds = [...new Set(payments.map((payment) => payment.appointmentId))];
  const invoiceLines = invoiceIds.length ? await db.select({
    id: invoiceLineItems.id,
    invoiceId: invoiceLineItems.invoiceId,
    kind: invoiceLineItems.kind,
    quantity: invoiceLineItems.quantity,
    unitPriceCents: invoiceLineItems.unitPriceCents,
    totalCents: invoiceLineItems.totalCents,
  }).from(invoiceLineItems).where(and(
    eq(invoiceLineItems.organizationId, input.organizationId),
    inArray(invoiceLineItems.invoiceId, invoiceIds),
  )) : [];
  const appointmentRows = appointmentIds.length ? await db.select({
    id: appointments.id,
    staffId: appointments.staffId,
  }).from(appointments).where(and(
    eq(appointments.organizationId, input.organizationId),
    eq(appointments.locationId, input.locationId),
    inArray(appointments.id, appointmentIds),
  )) : [];
  const approvedReportedTips = await db.select({
    id: timesheetShifts.id,
    weekId: timesheetShifts.weekId,
    staffId: timesheetShifts.staffId,
    workDate: timesheetShifts.workDate,
    locationId: timesheetShifts.locationId,
    startTime: timesheetShifts.startTime,
    endTime: timesheetShifts.endTime,
    tipsCents: timesheetShifts.tipsCents,
    updatedAt: timesheetShifts.updatedAt,
    weekRevision: timesheetWeeks.revision,
    weekUpdatedAt: timesheetWeeks.updatedAt,
  }).from(timesheetShifts).innerJoin(
    timesheetWeeks,
    and(eq(timesheetShifts.weekId, timesheetWeeks.id), eq(timesheetShifts.organizationId, timesheetWeeks.organizationId)),
  ).where(and(
    eq(timesheetShifts.organizationId, input.organizationId),
    eq(timesheetWeeks.status, "approved"),
    shiftLocationCondition,
    gte(timesheetShifts.workDate, input.startsOn),
    lte(timesheetShifts.workDate, input.endsOn),
  ));

  const snapshot: PayrollInputSnapshot = {
    version: 1,
    location: snapshotComponent([[location.id, location.name, location.currency, location.timezone]]),
    team: snapshotComponent(team.map((person) => [person.assignmentId, person.id, person.displayName])),
    compensationProfiles: snapshotComponent(profiles.map((profile) => [
      profile.id,
      profile.staffId,
      profile.workerClass,
      profile.payType,
      profile.hourlyRateCents,
      profile.annualSalaryCents,
      profile.overtimeEligible ? 1 : 0,
      profile.weeklyOvertimeMinutes,
      profile.overtimeMultiplierBps,
      profile.serviceCommissionBps,
      profile.retailCommissionBps,
      profile.currency,
      profile.effectiveFrom,
    ])),
    approvedTime: snapshotComponent(effectiveEntries.map((entry) => {
      const adjustment = latest.get(entry.id);
      return [
        entry.id,
        entry.staffId,
        entry.updatedAt,
        adjustment?.id || "",
        adjustment?.createdAt || "",
        entry.effectiveClockIn,
        entry.effectiveClockOut || "",
        entry.effectiveBreakMinutes,
      ];
    })),
    approvedReportedTips: snapshotComponent(approvedReportedTips.map((shift) => [
      shift.id,
      shift.weekId,
      shift.staffId,
      shift.workDate,
      shift.startTime,
      shift.endTime,
      shift.tipsCents,
      shift.updatedAt,
      shift.weekRevision,
      shift.weekUpdatedAt,
      shift.locationId || "",
    ])),
    payments: snapshotComponent(payments.map((payment) => [
      payment.id,
      payment.invoiceId,
      payment.appointmentId,
      payment.kind,
      payment.method,
      payment.amountCents,
      payment.taxAmountCents,
      payment.tipAmountCents,
      payment.status,
      payment.parentPaymentId || "",
      payment.occurredAt,
    ])),
    invoiceLines: snapshotComponent(invoiceLines.map((line) => [
      line.id,
      line.invoiceId,
      line.kind,
      line.quantity,
      line.unitPriceCents,
      line.totalCents,
    ])),
    appointmentAssignments: snapshotComponent(appointmentRows.map((appointment) => [
      appointment.id,
      appointment.staffId || "",
    ])),
  };
  const inputSnapshotJson = JSON.stringify(snapshot);
  return {
    location,
    bounds,
    allowLegacyLocationName,
    team,
    profiles,
    effectiveEntries,
    payments,
    invoiceLines,
    appointmentRows,
    approvedReportedTips,
    snapshot,
    inputSnapshotJson,
    inputSnapshotHash: await sha256(inputSnapshotJson),
  };
}

function payrollInputGuardSql(input: {
  organizationId: string;
  locationId: string;
  startsOn: string;
  endsOn: string;
  bounds: { start: string; end: string };
  locationName: string;
  allowLegacyLocationName: boolean;
  inputSnapshotJson: string;
  inputSnapshotHash: string;
  expectedPeriod?: { id: string; updatedAt: string; requireStoredSnapshot: boolean };
}) {
  return sql<string>`(
    with expected as (
      select
        ${input.organizationId}::text as organization_id,
        ${input.locationId}::text as location_id,
        ${input.startsOn}::text as starts_on,
        ${input.endsOn}::text as ends_on,
        ${input.bounds.start}::text as bounds_start,
        ${input.bounds.end}::text as bounds_end,
        ${input.locationName}::text as location_name,
        ${input.allowLegacyLocationName ? 1 : 0}::int as allow_legacy_location_name,
        ${input.inputSnapshotJson}::text as snapshot_json,
        ${input.inputSnapshotHash}::text as snapshot_hash,
        ${input.expectedPeriod?.id || ""}::text as expected_period_id,
        ${input.expectedPeriod?.updatedAt || ""}::text as expected_period_updated_at,
        ${input.expectedPeriod?.requireStoredSnapshot ? 1 : 0}::int as require_stored_snapshot
    )
    select payroll_location.organization_id
    from locations as payroll_location
    cross join expected
    where payroll_location.id = expected.location_id
      and payroll_location.organization_id = expected.organization_id
      and payroll_location.active
      and ${sql.raw(jsonRowSql(["payroll_location.id", "payroll_location.name", "payroll_location.currency", "payroll_location.timezone"]))}
        = (expected.snapshot_json::json #>> '{location,signature}')
      and (
        expected.allow_legacy_location_name = 0
        or (
          select count(*)
          from locations as same_name_location
          where same_name_location.organization_id = expected.organization_id
            and same_name_location.name = expected.location_name
        ) = 1
      )
      and (
        expected.allow_legacy_location_name = 1
        or not exists (
          select 1
          from timesheet_shifts as ambiguous_shift
          inner join timesheet_weeks as ambiguous_week
            on ambiguous_week.id = ambiguous_shift.week_id
            and ambiguous_week.organization_id = ambiguous_shift.organization_id
          where ambiguous_shift.organization_id = expected.organization_id
            and ambiguous_shift.location_id is null
            and ambiguous_shift.location_name = expected.location_name
            and ambiguous_shift.work_date >= expected.starts_on
            and ambiguous_shift.work_date <= expected.ends_on
            and ambiguous_week.status in ('submitted', 'approved')
        )
      )
      and not exists (
        select 1
        from time_entries as pending_entry
        left join time_entry_adjustments as pending_adjustment
          on pending_adjustment.id = (
            select candidate_pending_adjustment.id
            from time_entry_adjustments as candidate_pending_adjustment
            where candidate_pending_adjustment.organization_id = expected.organization_id
              and candidate_pending_adjustment.location_id = expected.location_id
              and candidate_pending_adjustment.time_entry_id = pending_entry.id
            order by candidate_pending_adjustment.created_at desc, candidate_pending_adjustment.id desc
            limit 1
          )
        where pending_entry.organization_id = expected.organization_id
          and pending_entry.location_id = expected.location_id
          and (
            (pending_entry.status = 'open' and pending_entry.clock_in < expected.bounds_end)
            or (
              pending_entry.status = 'submitted'
              and coalesce(pending_adjustment.clock_in, pending_entry.clock_in) >= expected.bounds_start
              and coalesce(pending_adjustment.clock_in, pending_entry.clock_in) < expected.bounds_end
            )
          )
      )
      and not exists (
        select 1
        from timesheet_weeks as pending_week
        inner join timesheet_shifts as pending_shift
          on pending_shift.week_id = pending_week.id
          and pending_shift.organization_id = pending_week.organization_id
        where pending_week.organization_id = expected.organization_id
          and pending_week.status = 'submitted'
          and pending_shift.organization_id = expected.organization_id
          and (
            pending_shift.location_id = expected.location_id
            or (
              expected.allow_legacy_location_name = 1
              and pending_shift.location_id is null
              and pending_shift.location_name = expected.location_name
            )
          )
          and pending_shift.work_date >= expected.starts_on
          and pending_shift.work_date <= expected.ends_on
      )
      and coalesce((
        select string_agg(team_row, '|' order by team_sort collate "C")
        from (
          select ${sql.raw(jsonRowSql(["team_assignment.id", "team_staff.id", "team_staff.display_name"]))} as team_row,
                 team_assignment.id as team_sort
          from staff_locations as team_assignment
          inner join staff as team_staff on team_staff.id = team_assignment.staff_id
          where team_assignment.organization_id = expected.organization_id
            and team_assignment.location_id = expected.location_id
            and team_assignment.active
            and team_staff.organization_id = expected.organization_id
            and team_staff.active
        ) as team_rows
      ), '') = (expected.snapshot_json::json #>> '{team,signature}')
      and coalesce((
        select string_agg(profile_row, '|' order by profile_sort collate "C")
        from (
          select ${sql.raw(jsonRowSql([
            "profile.id",
            "profile.staff_id",
            "profile.worker_class",
            "profile.pay_type",
            "profile.hourly_rate_cents",
            "profile.annual_salary_cents",
            "case when profile.overtime_eligible then 1 else 0 end",
            "profile.weekly_overtime_minutes",
            "profile.overtime_multiplier_bps",
            "profile.service_commission_bps",
            "profile.retail_commission_bps",
            "profile.currency",
            "profile.effective_from",
          ]))} as profile_row,
                 profile.id as profile_sort
          from compensation_profiles as profile
          where profile.organization_id = expected.organization_id
            and profile.location_id = expected.location_id
            and profile.effective_from <= expected.ends_on
        ) as profile_rows
      ), '') = (expected.snapshot_json::json #>> '{compensationProfiles,signature}')
      and coalesce((
        select string_agg(work_row, '|' order by work_sort collate "C")
        from (
          select ${sql.raw(jsonRowSql([
            "approved_entry.id",
            "approved_entry.staff_id",
            "approved_entry.updated_at",
            "coalesce(latest_adjustment.id, '')",
            "coalesce(latest_adjustment.created_at, '')",
            "coalesce(latest_adjustment.clock_in, approved_entry.clock_in)",
            "coalesce(latest_adjustment.clock_out, approved_entry.clock_out, '')",
            "coalesce(latest_adjustment.break_minutes, approved_entry.break_minutes)",
          ]))} as work_row,
                 approved_entry.id as work_sort
          from time_entries as approved_entry
          left join time_entry_adjustments as latest_adjustment
            on latest_adjustment.id = (
              select candidate_adjustment.id
              from time_entry_adjustments as candidate_adjustment
              where candidate_adjustment.organization_id = expected.organization_id
                and candidate_adjustment.location_id = expected.location_id
                and candidate_adjustment.time_entry_id = approved_entry.id
              order by candidate_adjustment.created_at desc, candidate_adjustment.id desc
              limit 1
            )
          where approved_entry.organization_id = expected.organization_id
            and approved_entry.location_id = expected.location_id
            and approved_entry.status = 'approved'
            and coalesce(latest_adjustment.clock_in, approved_entry.clock_in) >= expected.bounds_start
            and coalesce(latest_adjustment.clock_in, approved_entry.clock_in) < expected.bounds_end
        ) as work_rows
      ), '') = (expected.snapshot_json::json #>> '{approvedTime,signature}')
      and coalesce((
        select string_agg(tip_row, '|' order by tip_sort collate "C")
        from (
          select ${sql.raw(jsonRowSql([
            "approved_shift.id",
            "approved_shift.week_id",
            "approved_shift.staff_id",
            "approved_shift.work_date",
            "approved_shift.start_time",
            "approved_shift.end_time",
            "approved_shift.tips_cents",
            "approved_shift.updated_at",
            "approved_week.revision",
            "approved_week.updated_at",
            "coalesce(approved_shift.location_id, '')",
          ]))} as tip_row,
                 approved_shift.id as tip_sort
          from timesheet_shifts as approved_shift
          inner join timesheet_weeks as approved_week
            on approved_week.id = approved_shift.week_id
            and approved_week.organization_id = approved_shift.organization_id
          where approved_shift.organization_id = expected.organization_id
            and approved_week.status = 'approved'
            and (
              approved_shift.location_id = expected.location_id
              or (
                expected.allow_legacy_location_name = 1
                and approved_shift.location_id is null
                and approved_shift.location_name = expected.location_name
              )
            )
            and approved_shift.work_date >= expected.starts_on
            and approved_shift.work_date <= expected.ends_on
        ) as tip_rows
      ), '') = (expected.snapshot_json::json #>> '{approvedReportedTips,signature}')
      and coalesce((
        select string_agg(payment_row, '|' order by payment_sort collate "C")
        from (
          select ${sql.raw(jsonRowSql([
            "pay_event.id",
            "pay_event.invoice_id",
            "pay_event.appointment_id",
            "pay_event.kind",
            "pay_event.method",
            "pay_event.amount_cents",
            "pay_event.tax_amount_cents",
            "pay_event.tip_amount_cents",
            "pay_event.status",
            "coalesce(pay_event.parent_payment_id, '')",
            "pay_event.occurred_at",
          ]))} as payment_row,
                 pay_event.id as payment_sort
          from payment_events as pay_event
          where pay_event.organization_id = expected.organization_id
            and pay_event.location_id = expected.location_id
            and pay_event.status = 'succeeded'
            and pay_event.occurred_at >= expected.bounds_start
            and pay_event.occurred_at < expected.bounds_end
        ) as payment_rows
      ), '') = (expected.snapshot_json::json #>> '{payments,signature}')
      and coalesce((
        select string_agg(line_row, '|' order by line_sort collate "C")
        from (
          select ${sql.raw(jsonRowSql([
            "invoice_line.id",
            "invoice_line.invoice_id",
            "invoice_line.kind",
            "invoice_line.quantity",
            "invoice_line.unit_price_cents",
            "invoice_line.total_cents",
          ]))} as line_row,
                 invoice_line.id as line_sort
          from invoice_line_items as invoice_line
          where invoice_line.organization_id = expected.organization_id
            and exists (
              select 1
              from payment_events as line_payment
              where line_payment.organization_id = expected.organization_id
                and line_payment.location_id = expected.location_id
                and line_payment.status = 'succeeded'
                and line_payment.occurred_at >= expected.bounds_start
                and line_payment.occurred_at < expected.bounds_end
                and line_payment.invoice_id = invoice_line.invoice_id
            )
        ) as line_rows
      ), '') = (expected.snapshot_json::json #>> '{invoiceLines,signature}')
      and coalesce((
        select string_agg(assignment_row, '|' order by assignment_sort collate "C")
        from (
          select ${sql.raw(jsonRowSql(["payroll_appointment.id", "coalesce(payroll_appointment.staff_id, '')"]))} as assignment_row,
                 payroll_appointment.id as assignment_sort
          from appointments as payroll_appointment
          where payroll_appointment.organization_id = expected.organization_id
            and payroll_appointment.location_id = expected.location_id
            and exists (
              select 1
              from payment_events as appointment_payment
              where appointment_payment.organization_id = expected.organization_id
                and appointment_payment.location_id = expected.location_id
                and appointment_payment.status = 'succeeded'
                and appointment_payment.occurred_at >= expected.bounds_start
                and appointment_payment.occurred_at < expected.bounds_end
                and appointment_payment.appointment_id = payroll_appointment.id
            )
        ) as assignment_rows
      ), '') = (expected.snapshot_json::json #>> '{appointmentAssignments,signature}')
      and (
        expected.expected_period_id = ''
        or exists (
          select 1
          from payroll_periods as expected_period
          where expected_period.id = expected.expected_period_id
            and expected_period.organization_id = expected.organization_id
            and expected_period.location_id = expected.location_id
            and expected_period.status in ('draft', 'reopened')
            and expected_period.updated_at = expected.expected_period_updated_at
            and (
              expected.require_stored_snapshot = 0
              or (
                expected_period.input_snapshot_hash = expected.snapshot_hash
                and expected_period.input_snapshot_json = expected.snapshot_json
              )
            )
        )
      )
  )`;
}

export async function GET() {
  try { const { db, membership } = await requireSalonAccess(); requirePayrollAccess(membership); const periods = await db.select().from(payrollPeriods).where(and(eq(payrollPeriods.organizationId, membership.organizationId), eq(payrollPeriods.locationId, membership.locationId))).orderBy(desc(payrollPeriods.startsOn)); const lines = await db.select().from(payrollLines).where(and(eq(payrollLines.organizationId, membership.organizationId), eq(payrollLines.locationId, membership.locationId))).orderBy(asc(payrollLines.staffName)); return Response.json({ canManage: ["owner", "manager"].includes(membership.role), disclaimer: PAYROLL_DISCLAIMER, periods: periods.map((period) => ({ ...period, lines: lines.filter((line) => line.payrollPeriodId === period.id) })) }); }
  catch (error) { return salonApiError(error, "Payroll could not be loaded."); }
}

export async function POST(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requirePayrollManagement(membership);
    const body = await request.json() as Record<string, unknown>;
    const startsOn = date(body.startsOn, "Start date");
    const endsOn = date(body.endsOn, "End date");
    const payDate = date(body.payDate, "Pay date");
    const days = Math.round((new Date(`${endsOn}T00:00:00Z`).getTime() - new Date(`${startsOn}T00:00:00Z`).getTime()) / 86400000) + 1;
    if (![7, 14].includes(days)) throw new SalonAccessError("Pay periods must cover exactly 7 or 14 days.", 400);
    const idempotencyKey = String(body.idempotencyKey || crypto.randomUUID()).trim().slice(0, 120);
    const [existing] = await db.select().from(payrollPeriods).where(and(eq(payrollPeriods.organizationId, membership.organizationId), eq(payrollPeriods.idempotencyKey, idempotencyKey))).limit(1);
    if (existing) {
      if (existing.locationId !== membership.locationId || existing.startsOn !== startsOn || existing.endsOn !== endsOn || existing.payDate !== payDate) {
        throw new SalonAccessError("That payroll request key was already used for different period details.", 409);
      }
      return Response.json({ period: existing });
    }
    const [samePeriod] = await db.select().from(payrollPeriods).where(and(
      eq(payrollPeriods.organizationId, membership.organizationId),
      eq(payrollPeriods.locationId, membership.locationId),
      eq(payrollPeriods.startsOn, startsOn),
      eq(payrollPeriods.endsOn, endsOn),
    )).limit(1);
    if (samePeriod && !["draft", "reopened"].includes(samePeriod.status)) {
      throw new SalonAccessError("Approved or exported payroll must be reopened before it can be rebuilt.", 409);
    }
    const inputs = await loadPayrollInputs(db, {
      organizationId: membership.organizationId,
      locationId: membership.locationId,
      startsOn,
      endsOn,
    });
    const {
      location,
      bounds,
      allowLegacyLocationName,
      team,
      profiles,
      effectiveEntries,
      payments,
      invoiceLines,
      appointmentRows,
      approvedReportedTips,
      inputSnapshotJson,
      inputSnapshotHash,
    } = inputs;
    const appointmentsById = new Map(appointmentRows.map((item) => [item.id, item]));
    const invoiceBases = new Map<string, { service: number; retail: number; total: number }>();
    for (const line of invoiceLines) {
      const current = invoiceBases.get(line.invoiceId) || { service: 0, retail: 0, total: 0 };
      const amount = Math.max(0, line.totalCents);
      current.total += amount;
      if (line.kind === "service") current.service += amount;
      if (line.kind === "product") current.retail += amount;
      invoiceBases.set(line.invoiceId, current);
    }
    const currentProfile = new Map<string, typeof profiles[number]>();
    for (const profile of profiles) if (!currentProfile.has(profile.staffId)) currentProfile.set(profile.staffId, profile);
    const periodId = samePeriod?.id || crypto.randomUUID();
    const lines = team.flatMap((person) => {
      const profile = currentProfile.get(person.id);
      if (!profile) return [];
      if (profile.currency !== location.currency) throw new SalonAccessError(`${person.displayName}'s compensation currency does not match this location.`, 409);
      const ownEntries = effectiveEntries.filter((entry) => entry.staffId === person.id && entry.effectiveClockOut).map((entry) => ({ clockIn: entry.effectiveClockIn, clockOut: entry.effectiveClockOut!, breakMinutes: entry.effectiveBreakMinutes }));
      const { regularMinutes, overtimeMinutes } = splitWeeklyMinutes(ownEntries, profile.weeklyOvertimeMinutes, profile.overtimeEligible, location.timezone);
      const ownPayments = payments.filter((payment) => appointmentsById.get(payment.appointmentId)?.staffId === person.id);
      const commissionRevenue = ownPayments.reduce((totals, payment) => {
        const bases = invoiceBases.get(payment.invoiceId);
        const split = bases ? splitCommissionRevenue(signedServicePrincipal(payment), bases.service, bases.retail, bases.total) : { serviceRevenueCents: signedServicePrincipal(payment), retailRevenueCents: 0 };
        totals.serviceRevenueCents += split.serviceRevenueCents;
        totals.retailRevenueCents += split.retailRevenueCents;
        return totals;
      }, { serviceRevenueCents: 0, retailRevenueCents: 0 });
      const checkoutTipsCents = ownPayments.reduce((sum, payment) => sum + (payment.kind === "refund" ? -payment.tipAmountCents : payment.tipAmountCents), 0);
      const employeeReportedTipsCents = approvedReportedTips.filter((shift) => shift.staffId === person.id).reduce((sum, shift) => sum + shift.tipsCents, 0);
      const tipsCents = mergeReportedTips(checkoutTipsCents, employeeReportedTipsCents);
      const snapshot: CompensationSnapshot = { payType: profile.payType, hourlyRateCents: profile.hourlyRateCents, annualSalaryCents: profile.annualSalaryCents, overtimeEligible: profile.overtimeEligible, weeklyOvertimeMinutes: profile.weeklyOvertimeMinutes, overtimeMultiplierBps: profile.overtimeMultiplierBps, serviceCommissionBps: profile.serviceCommissionBps, retailCommissionBps: profile.retailCommissionBps, currency: profile.currency };
      const gross = calculateGross(snapshot, regularMinutes, overtimeMinutes, days, commissionRevenue.serviceRevenueCents, tipsCents);
      const retailCommissionCents = calculateRetailCommission(snapshot, commissionRevenue.retailRevenueCents);
      return [{ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: membership.locationId, payrollPeriodId: periodId, staffId: person.id, staffName: person.displayName, regularMinutes, overtimeMinutes, ...gross, retailCommissionCents, grossPayCents: gross.grossPayCents + retailCommissionCents, payoutCents: gross.payoutCents + retailCommissionCents, tipsCents, compensationSnapshotJson: JSON.stringify({ ...snapshot, profileId: profile.id, effectiveFrom: profile.effectiveFrom, serviceRevenueCents: commissionRevenue.serviceRevenueCents, retailRevenueCents: commissionRevenue.retailRevenueCents, checkoutTipsCents, employeeReportedTipsCents, tipMergeRule: "max_without_double_counting", timezone: location.timezone }) }];
    });
    const now = new Date().toISOString();
    const periodWrite = db.insert(payrollPeriods).values({
      id: periodId,
      organizationId: membership.organizationId,
      locationId: membership.locationId,
      startsOn,
      endsOn,
      payDate,
      currency: location.currency,
      idempotencyKey,
      inputSnapshotJson,
      inputSnapshotHash,
      createdByStaffId: membership.id,
    }).returning();
    const periodRewrite = samePeriod ? db.update(payrollPeriods).set({
      payDate,
      status: "draft",
      currency: location.currency,
      idempotencyKey,
      inputSnapshotJson,
      inputSnapshotHash,
      approvedByStaffId: null,
      approvedAt: null,
      exportedAt: null,
      createdByStaffId: membership.id,
      updatedAt: now,
    }).where(and(
      eq(payrollPeriods.id, samePeriod.id),
      eq(payrollPeriods.organizationId, membership.organizationId),
      eq(payrollPeriods.locationId, membership.locationId),
      inArray(payrollPeriods.status, ["draft", "reopened"]),
      eq(payrollPeriods.updatedAt, samePeriod.updatedAt),
    )).returning() : null;
    const audit = db.insert(auditEvents).values({
      id: crypto.randomUUID(),
      organizationId: payrollInputGuardSql({
        organizationId: membership.organizationId,
        locationId: membership.locationId,
        startsOn,
        endsOn,
        bounds,
        locationName: location.name,
        allowLegacyLocationName,
        inputSnapshotJson,
        inputSnapshotHash,
        expectedPeriod: samePeriod ? { id: samePeriod.id, updatedAt: samePeriod.updatedAt, requireStoredSnapshot: false } : undefined,
      }),
      actorType: "staff",
      actorId: membership.id,
      action: samePeriod ? "payroll.period_rebuilt" : "payroll.period_built",
      entityType: "payroll_period",
      entityId: periodId,
      detailsJson: JSON.stringify({ startsOn, endsOn, timezone: location.timezone, lineCount: lines.length, inputSnapshotHash }),
    });
    let period;
    try {
      if (samePeriod && periodRewrite) {
        const removeOldLines = db.delete(payrollLines).where(and(
          eq(payrollLines.payrollPeriodId, samePeriod.id),
          eq(payrollLines.organizationId, membership.organizationId),
          eq(payrollLines.locationId, membership.locationId),
        ));
        if (lines.length) {
          const results = await db.batch([audit, removeOldLines, periodRewrite, db.insert(payrollLines).values(lines)]);
          period = results[2][0];
        } else {
          const results = await db.batch([audit, removeOldLines, periodRewrite]);
          period = results[2][0];
        }
      } else if (lines.length) {
        const results = await db.batch([periodWrite, db.insert(payrollLines).values(lines), audit]);
        period = results[0][0];
      } else {
        const results = await db.batch([periodWrite, audit]);
        period = results[0][0];
      }
    } catch (error) {
      if (error instanceof Error && /constraint|null|unique/i.test(databaseErrorMessage(error))) throw new SalonAccessError("Payroll inputs changed or the draft was updated elsewhere. Refresh and rebuild payroll.", 409);
      throw error;
    }
    if (!period) throw new SalonAccessError("Payroll inputs changed or the draft was updated elsewhere. Refresh and rebuild payroll.", 409);
    return Response.json({ period: { ...period, lines } }, { status: samePeriod ? 200 : 201 });
  } catch (error) { return salonApiError(error, "Payroll period could not be built."); }
}

export async function PATCH(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requirePayrollManagement(membership);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");
    const periodId = String(body.periodId || "");
    const [period] = await db.select().from(payrollPeriods).where(and(eq(payrollPeriods.id, periodId), eq(payrollPeriods.organizationId, membership.organizationId), eq(payrollPeriods.locationId, membership.locationId))).limit(1);
    if (!period) throw new SalonAccessError("Payroll period not found.", 404);
    const [location] = await db.select({ timezone: locations.timezone }).from(locations).where(and(eq(locations.id, membership.locationId), eq(locations.organizationId, membership.organizationId), eq(locations.active, true))).limit(1);
    if (!location) throw new SalonAccessError("Payroll location not found.", 404);
    const bounds = periodBounds(period.startsOn, period.endsOn, location.timezone);
    const now = new Date().toISOString();
    if (action === "approve") {
      const pending = await db.select({ id: timeEntries.id }).from(timeEntries).where(and(eq(timeEntries.organizationId, membership.organizationId), eq(timeEntries.locationId, membership.locationId), eq(timeEntries.status, "submitted"), gte(timeEntries.clockIn, bounds.start), lt(timeEntries.clockIn, bounds.end))).limit(1);
      if (pending.length) throw new SalonAccessError("Approve or reject every submitted time entry before approving payroll.", 409);
      let updated;
      try {
        const results = await db.batch([
          db.insert(auditEvents).values({
            id: crypto.randomUUID(),
            organizationId: sql<string>`(
              select organization_id from payroll_periods
              where id = ${period.id}
                and organization_id = ${membership.organizationId}
                and location_id = ${membership.locationId}
                and status in ('draft', 'reopened')
            )`,
            actorType: "staff",
            actorId: membership.id,
            action: "payroll.period_approved",
            entityType: "payroll_period",
            entityId: period.id,
          }),
          db.update(payrollPeriods).set({ status: "approved", approvedByStaffId: membership.id, approvedAt: now, updatedAt: now }).where(and(eq(payrollPeriods.id, period.id), inArray(payrollPeriods.status, ["draft", "reopened"]))).returning(),
        ]);
        updated = results[1][0];
      } catch (error) {
        if (error instanceof Error && /constraint|null|unique/i.test(databaseErrorMessage(error))) throw new SalonAccessError("Only draft or reopened payroll can be approved.", 409);
        throw error;
      }
      if (!updated) throw new SalonAccessError("Only draft or reopened payroll can be approved.", 409);
      return Response.json({ period: updated });
    }
    if (action === "reopen") {
      const reason = String(body.reason || "").trim();
      if (reason.length < 3) throw new SalonAccessError("A reopen reason is required.", 400);
      let updated;
      try {
        const results = await db.batch([
          db.insert(auditEvents).values({
            id: crypto.randomUUID(),
            organizationId: sql<string>`(
              select organization_id from payroll_periods
              where id = ${period.id}
                and organization_id = ${membership.organizationId}
                and location_id = ${membership.locationId}
                and status in ('approved', 'exported')
            )`,
            actorType: "staff",
            actorId: membership.id,
            action: "payroll.period_reopened",
            entityType: "payroll_period",
            entityId: period.id,
            detailsJson: JSON.stringify({ reason }),
          }),
          db.update(payrollPeriods).set({ status: "reopened", approvedByStaffId: null, approvedAt: null, updatedAt: now }).where(and(eq(payrollPeriods.id, period.id), inArray(payrollPeriods.status, ["approved", "exported"]))).returning(),
        ]);
        updated = results[1][0];
      } catch (error) {
        if (error instanceof Error && /constraint|null|unique/i.test(databaseErrorMessage(error))) throw new SalonAccessError("Only approved or exported payroll can be reopened.", 409);
        throw error;
      }
      if (!updated) throw new SalonAccessError("Only approved or exported payroll can be reopened.", 409);
      return Response.json({ period: updated });
    }
    throw new SalonAccessError("Unsupported payroll action.", 400);
  }
  catch (error) { return salonApiError(error, "Payroll period could not be updated."); }
}
