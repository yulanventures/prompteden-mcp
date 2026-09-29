/**
 * Monitor targets are answer engines from the provider catalog.
 * Coding-agent entries are omitted from list_providers and rejected by create_monitor.
 */

export type MonitorProviderRecord = {
  key?: string;
  name?: string;
  category?: string;
  description?: string;
};

const EXCLUDED_PROVIDER_KEYS = new Set(["claude-code", "codex"]);

function normalized(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function isExcludedMonitorProviderKey(providerKey: string): boolean {
  return EXCLUDED_PROVIDER_KEYS.has(normalized(providerKey));
}

export function isExcludedMonitorProvider(provider: MonitorProviderRecord): boolean {
  if (isExcludedMonitorProviderKey(provider.key ?? "")) return true;
  const category = normalized(provider.category);
  if (
    category === "agent" ||
    category === "agent coding harnesses" ||
    category.includes("harness")
  ) {
    return true;
  }
  const text = `${normalized(provider.name)} ${normalized(provider.description)}`;
  return text.includes("coding harness") || text.includes("agent harness");
}

export function visibleMonitorProviders(providers: unknown[]): unknown[] {
  return providers.filter((provider) => {
    if (typeof provider !== "object" || provider === null || Array.isArray(provider)) {
      return false;
    }
    return !isExcludedMonitorProvider(provider as MonitorProviderRecord);
  });
}

export function allowedMonitorProviderKeys(providers: unknown[]): Set<string> {
  const allowed = new Set<string>();
  for (const provider of visibleMonitorProviders(providers)) {
    if (typeof provider !== "object" || provider === null) continue;
    const key = normalized((provider as MonitorProviderRecord).key);
    if (key) allowed.add(key);
  }
  return allowed;
}

/** Keys that are absent from the filtered catalog, including category-excluded entries. */
export function unavailableMonitorProviderKeys(
  requested: string[],
  providers: unknown[],
): string[] {
  const allowed = allowedMonitorProviderKeys(providers);
  return requested.filter((key) => !allowed.has(normalized(key)));
}
