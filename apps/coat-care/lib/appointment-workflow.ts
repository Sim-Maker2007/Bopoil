export const appointmentTransitions: Record<string, readonly string[]> = {
  requested: ["confirmed", "cancelled"],
  confirmed: ["arrived", "cancelled", "no_show"],
  arrived: ["bathing", "cancelled"],
  bathing: ["drying"],
  drying: ["grooming"],
  grooming: ["quality_check"],
  quality_check: ["grooming", "ready"],
  ready: ["completed"],
  completed: [],
  cancelled: [],
  no_show: [],
};

export function canTransitionAppointment(from: string, to: string) {
  return appointmentTransitions[from]?.includes(to) ?? false;
}
