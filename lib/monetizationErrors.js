export const FREE_GARDEN_LIMIT_REACHED = "FREE_GARDEN_LIMIT_REACHED";
export const FREE_REMINDER_PLANT_LIMIT_REACHED = "FREE_REMINDER_PLANT_LIMIT_REACHED";

export function monetizationErrorCode(error) {
  const haystack = [
    error && error.message,
    error && error.details,
    error && error.hint,
    error && error.code,
  ]
    .filter(Boolean)
    .join(" ");

  if (haystack.includes(FREE_GARDEN_LIMIT_REACHED)) return FREE_GARDEN_LIMIT_REACHED;
  if (haystack.includes(FREE_REMINDER_PLANT_LIMIT_REACHED)) return FREE_REMINDER_PLANT_LIMIT_REACHED;
  return null;
}
