export const EXPOSURE_TYPES = [
  { id: "full_sun", label: "Plein soleil", icon: "☀️" },
  { id: "partial_sun", label: "Mi-ombre", icon: "⛅" },
  { id: "bright_shade", label: "Ombre lumineuse", icon: "🌥️" },
  { id: "shade", label: "Ombre", icon: "🌑" },
  { id: "unknown", label: "Je ne sais pas", icon: "❓" },
];

export const ORIENTATION_TYPES = [
  { id: "n", label: "Nord" },
  { id: "ne", label: "Nord-Est" },
  { id: "e", label: "Est" },
  { id: "se", label: "Sud-Est" },
  { id: "s", label: "Sud" },
  { id: "sw", label: "Sud-Ouest" },
  { id: "w", label: "Ouest" },
  { id: "nw", label: "Nord-Ouest" },
  { id: "unknown", label: "Je ne sais pas" },
];

export const WATERING_MODES = [
  { id: "manual", label: "Manuel", icon: "💧" },
  { id: "automatic", label: "Automatique", icon: "🚿" },
];

export const WATERING_TYPES = [
  { id: "drip", label: "Goutte-à-goutte" },
  { id: "micro_sprinkler", label: "Micro-asperseur" },
  { id: "sprinkler", label: "Asperseur" },
  { id: "soaker_hose", label: "Tuyau poreux" },
  { id: "other", label: "Autre" },
];

export const EMPTY_PLANT_CONTEXT = {
  location: null,
  exposure: null,
  orientation: null,
  watering: {
    mode: null,
    type: null,
    frequencyDays: null,
    durationMinutes: null,
    flowLph: null,
    emitterCount: null,
  },
};
