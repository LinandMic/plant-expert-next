const VISIBLE_STATUSES = ["pending", "snoozed"];

// Pure: no React state, no side effect. Groups active, pending/snoozed
// reminders first by exact next_due_date, then by type within that date.
export function groupRemindersForDashboard(reminders) {
  const visible = (reminders || [])
    .filter((r) => r.isActive && VISIBLE_STATUSES.includes(r.status))
    .slice()
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));

  const byDate = new Map();
  for (const r of visible) {
    if (!byDate.has(r.nextDueDate)) byDate.set(r.nextDueDate, new Map());
    const byType = byDate.get(r.nextDueDate);
    if (!byType.has(r.type)) byType.set(r.type, { type: r.type, plantIds: [], hasSnoozed: false });
    const group = byType.get(r.type);
    group.plantIds.push(r.plantId);
    if (r.status === "snoozed") group.hasSnoozed = true;
  }

  return Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, byType]) => ({ date, types: Array.from(byType.values()) }));
}
