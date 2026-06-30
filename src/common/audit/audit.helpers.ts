export function diffStringArrays(before: string[], after: string[]) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const added = after.filter((item) => !beforeSet.has(item));
  const removed = before.filter((item) => !afterSet.has(item));

  if (added.length === 0 && removed.length === 0) {
    return undefined;
  }

  return { added, removed };
}

export function compactMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) {
    return undefined;
  }

  const entries = Object.entries(metadata).filter(([, value]) => {
    if (value === undefined || value === null) {
      return false;
    }

    if (Array.isArray(value) && value.length === 0) {
      return false;
    }

    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    ) {
      return false;
    }

    return true;
  });

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}
