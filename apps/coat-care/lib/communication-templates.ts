export function renderCommunicationTemplate(value: string, variables: Record<string, string>) {
  return value.replace(/\{\{([a-z_]+)\}\}/g, (_, key: string) => variables[key] ?? "");
}

export function reminderSendAt(startsAt: string, nowMs = Date.now()) {
  return new Date(Math.max(nowMs, new Date(startsAt).getTime() - 24 * 60 * 60 * 1000)).toISOString();
}
