// Measurement sites, mirroring src/shared/types.ts on the web side (the mobile
// app is its own package, so the list is copied rather than imported).
export const MEASUREMENT_SITES = [
  "shoulders", "chest", "arm_l", "arm_r", "waist", "neck",
  "thigh", "glutes", "forearm_l", "forearm_r", "calf_l", "calf_r",
] as const;

const SITE_LABELS: Record<string, string> = {
  shoulders: "Shoulders", chest: "Chest", arm_l: "Arm (L)", arm_r: "Arm (R)",
  waist: "Waist", neck: "Neck", thigh: "Thigh", glutes: "Glutes",
  forearm_l: "Forearm (L)", forearm_r: "Forearm (R)", calf_l: "Calf (L)", calf_r: "Calf (R)",
};

// Any site the map doesn't cover (e.g. an AI-logged one-off) is prettified so
// it never renders as a raw "waist_hip" key: "waist_hip" -> "Waist Hip".
export const siteLabel = (site: string) =>
  SITE_LABELS[site] ?? site.split("_").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
