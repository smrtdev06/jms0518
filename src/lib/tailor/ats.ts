const TECH_TERMS = [
  "python", "java", "javascript", "typescript", "go", "golang", "c++", "c#", "ruby", "rust", "kotlin", "swift", "scala", "php", "sql",
  "react", "angular", "vue", "next.js", "node.js", "node", "django", "flask", "spring", "spring boot", ".net", "rails",
  "aws", "azure", "gcp", "google cloud", "kubernetes", "docker", "terraform", "ansible", "linux", "ci/cd", "jenkins", "github actions",
  "postgresql", "postgres", "mysql", "mongodb", "redis", "kafka", "spark", "hadoop", "snowflake", "bigquery", "redshift", "elasticsearch",
  "graphql", "microservices", "grpc", "rest", "api",
  "machine learning", "deep learning", "llm", "nlp", "pytorch", "tensorflow", "scikit-learn", "pandas", "airflow", "dbt",
  "react native", "android", "ios", "flutter",
  "security", "oauth", "observability", "prometheus", "grafana", "datadog",
  "agile", "scrum", "system design", "distributed systems",
];

// Terms that are also ordinary English words ("we go above and beyond", "the rest of the team").
// In the job description they count only in their technical spelling and next to other technical terms.
const AMBIGUOUS: Record<string, RegExp> = {
  go: /(^|[^A-Za-z0-9+#])Go([^A-Za-z0-9+#]|$)/,
  rest: /(^|[^A-Za-z0-9])REST(ful)?([^A-Za-z0-9]|$)/,
  node: /(^|[^A-Za-z0-9])Node([^A-Za-z0-9]|$)/,
  spring: /(^|[^A-Za-z0-9])Spring([^A-Za-z0-9]|$)/,
  swift: /(^|[^A-Za-z0-9])Swift([^A-Za-z0-9]|$)/,
  rust: /(^|[^A-Za-z0-9])Rust([^A-Za-z0-9]|$)/,
  ruby: /(^|[^A-Za-z0-9])Ruby([^A-Za-z0-9]|$)/,
  rails: /(^|[^A-Za-z0-9])Rails([^A-Za-z0-9]|$)/,
  spark: /(^|[^A-Za-z0-9])Spark([^A-Za-z0-9]|$)/,
  flask: /(^|[^A-Za-z0-9])Flask([^A-Za-z0-9]|$)/,
  react: /(^|[^A-Za-z0-9])React([^A-Za-z0-9]|$)/,
  api: /(^|[^A-Za-z0-9])APIs?([^A-Za-z0-9]|$)/,
  security: /security/i,
  agile: /agile/i,
};

// Scores how many of the job's technical keywords appear in the resume. The score is null when the
// job description names no technical keywords, so a non-technical job is not shown as 0/100.
export function scoreAts(jobText: string, resumeText: string, extra: string[] = []) {
  const haystack = resumeText.toLowerCase();
  const fromJob = TECH_TERMS.filter((term) => inJob(jobText, term));
  const fromExtra = extra
    .map((item) => item.toLowerCase().trim())
    .filter((item) => item.split(/\s+/).length <= 3 && item.length >= 2 && item.length < 40 && inJob(jobText, item));
  const terms = [...new Set([...fromJob, ...fromExtra])].slice(0, 24);
  const matched = terms.filter((term) => containsTerm(haystack, term));
  const missing = terms.filter((term) => !containsTerm(haystack, term));
  const score = terms.length ? Math.round((matched.length / terms.length) * 100) : null;
  return { score, matched, missing };
}

function inJob(jobText: string, term: string) {
  const ambiguous = AMBIGUOUS[term];
  if (!ambiguous) return containsTerm(jobText.toLowerCase(), term);
  // The sentence or line using the word must also name another, unambiguous technical term.
  return jobText.split(/\n|(?<=[.!?;])\s+/).some((part) => ambiguous.test(part) && TECH_TERMS.some((other) => other !== term && !AMBIGUOUS[other] && containsTerm(part.toLowerCase(), other)));
}

function containsTerm(haystack: string, term: string) {
  // Words of a multi-word term may be separated by any whitespace, including line breaks.
  // A plural ("APIs", "microservices") counts as the same term.
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  const plural = /[a-z]$/i.test(term) ? "(?:e?s)?" : "";
  return new RegExp(`(^|[^a-z0-9+#])${escaped}${plural}([^a-z0-9+#]|$)`, "i").test(haystack);
}
