export function localizeWithFallback(key, fallback = "") {
  const localized = typeof game !== "undefined" ? game?.i18n?.localize?.(key) : undefined;
  if (typeof localized === "string" && localized && localized !== key) {
    return localized;
  }

  return fallback;
}
