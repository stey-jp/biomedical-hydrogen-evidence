function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`);
  return `{${entries.join(",")}}`;
}

export function calculateFieldConsensus(extractions) {
  const eligible = extractions.filter((item) => item.normalizedValue !== undefined);
  if (eligible.length === 0) {
    return {
      normalizedValue: null,
      agreementCount: 0,
      totalCount: 0,
      status: "insufficient_data",
      groups: [],
      note: "Consensus describes model agreement only, not correctness.",
    };
  }

  const groups = new Map();
  for (const extraction of eligible) {
    const key = canonicalize(extraction.normalizedValue);
    const current = groups.get(key) ?? { value: extraction.normalizedValue, providers: [] };
    current.providers.push(extraction.provider);
    groups.set(key, current);
  }
  const ranked = [...groups.values()].sort((left, right) => right.providers.length - left.providers.length);
  const winner = ranked[0];
  const tied = ranked[1]?.providers.length === winner.providers.length;
  const unanimous = winner.providers.length === eligible.length;
  return {
    normalizedValue: tied ? null : winner.value,
    agreementCount: winner.providers.length,
    totalCount: eligible.length,
    status: eligible.length < 2
      ? "insufficient_data"
      : unanimous
        ? "agreement"
        : "needs_human_review",
    groups: ranked,
    note: "Consensus describes model agreement only, not correctness.",
  };
}

