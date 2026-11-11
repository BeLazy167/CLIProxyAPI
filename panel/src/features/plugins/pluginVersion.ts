export const formatPluginVersion = (version: string) => {
  const trimmed = version.trim();
  if (!trimmed) return '';
  return /^v/i.test(trimmed) ? trimmed : `v${trimmed}`;
};

export const normalizePluginVersion = (version: string) => version.trim().replace(/^v/i, '');

export const pluginVersionMatches = (left: string, right: string) =>
  normalizePluginVersion(left) === normalizePluginVersion(right);
