// Turns a fetched posting into the fields the tailoring prompt expects.
// This does not call OpenAI. A company site is used only when the page itself names one.

const STACK: { name: string; pattern: RegExp }[] = [
  { name: "Python", pattern: /\bPython\b/i },
  { name: "Java", pattern: /\bJava\b(?!Script)/i },
  { name: "JavaScript", pattern: /\bJavaScript\b|\bJS\b/ },
  { name: "TypeScript", pattern: /\bTypeScript\b/i },
  { name: "Go", pattern: /\bGolang\b|\bGo\b/ },
  { name: "C++", pattern: /\bC\+\+/ },
  { name: "C#", pattern: /\bC#/ },
  { name: "Ruby", pattern: /\bRuby\b/ },
  { name: "Rust", pattern: /\bRust\b/ },
  { name: "Kotlin", pattern: /\bKotlin\b/i },
  { name: "Swift", pattern: /\bSwift\b/ },
  { name: "Scala", pattern: /\bScala\b/i },
  { name: "PHP", pattern: /\bPHP\b/ },
  { name: "FastAPI", pattern: /\bFastAPI\b/i },
  { name: "Django", pattern: /\bDjango\b/i },
  { name: "Flask", pattern: /\bFlask\b/ },
  { name: "Spring Boot", pattern: /\bSpring Boot\b/i },
  { name: "Spring", pattern: /\bSpring\b/ },
  { name: "React", pattern: /\bReact(?:\.js)?\b/ },
  { name: "Next.js", pattern: /\bNext\.js\b/i },
  { name: "Angular", pattern: /\bAngular\b/i },
  { name: "Vue", pattern: /\bVue(?:\.js)?\b/i },
  { name: "Node.js", pattern: /\bNode(?:\.?js)?\b/ },
  { name: ".NET", pattern: /\.NET\b/ },
  { name: "Rails", pattern: /\bRails\b/ },
  { name: "AWS", pattern: /\bAWS\b|\bAmazon Web Services\b/i },
  { name: "Azure", pattern: /\bAzure\b/i },
  { name: "GCP", pattern: /\bGCP\b|\bGoogle Cloud\b/i },
  { name: "Kubernetes", pattern: /\bKubernetes\b|\bK8s\b/i },
  { name: "Docker", pattern: /\bDocker\b/i },
  { name: "Terraform", pattern: /\bTerraform\b/i },
  { name: "PostgreSQL", pattern: /\bPostgreSQL\b|\bPostgres\b/i },
  { name: "MySQL", pattern: /\bMySQL\b/i },
  { name: "MongoDB", pattern: /\bMongoDB\b/i },
  { name: "Redis", pattern: /\bRedis\b/i },
  { name: "Kafka", pattern: /\bKafka\b/i },
  { name: "DynamoDB", pattern: /\bDynamoDB\b/i },
  { name: "GraphQL", pattern: /\bGraphQL\b/i },
  { name: "gRPC", pattern: /\bgRPC\b/i },
];

// Job boards and social sites are never the hiring company's own site. Matched on the host, so a
// company such as dropbox.com is not mistaken for x.com.
const NOT_A_COMPANY_SITE = [
  "greenhouse.io", "lever.co", "ashbyhq.com", "linkedin.com", "myworkdayjobs.com", "myworkdaysite.com", "smartrecruiters.com",
  "workable.com", "recruitee.com", "bamboohr.com", "adp.com", "indeed.com", "glassdoor.com", "ziprecruiter.com", "monster.com",
  "jobvite.com", "icims.com", "taleo.net", "workday.com", "facebook.com", "twitter.com", "x.com", "instagram.com", "youtube.com",
  "github.com", "google.com",
];

function isJobBoardOrSocial(url: string) {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  return NOT_A_COMPANY_SITE.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

// Names that are also ordinary English ("Go above and beyond", "Spring hiring"). They count only in an
// unambiguous spelling, or in a sentence that also names another technology.
const AMBIGUOUS: Record<string, RegExp | null> = {
  Go: /\bGolang\b/i,
  "Node.js": /\bNode\.?js\b/i,
  React: /\bReact\.?js\b|\bReact Native\b/i,
  Spring: null,
  Swift: null,
  Rust: null,
  Ruby: null,
  Rails: /\bRuby on Rails\b/i,
  Flask: null,
};

function mentioned(item: { name: string; pattern: RegExp }, text: string) {
  if (!(item.name in AMBIGUOUS)) return item.pattern.test(text);
  if (AMBIGUOUS[item.name]?.test(text)) return true;
  return text.split(/\n|(?<=[.!?;])\s+/).some((part) => item.pattern.test(part) && STACK.some((other) => other.name !== item.name && !(other.name in AMBIGUOUS) && other.pattern.test(part)));
}

export type TargetJob = {
  jobTitle: string;
  jobStack: string;
  companyName: string;
  companyUrl: string;
  jobDescription: string;
};

export function buildTargetJob(input: { company: string; title: string; text: string; companyUrl?: string }): TargetJob {
  const companyName = clean(input.company) || "Company";
  const jobTitle = clean(input.title) || "Role";
  return {
    jobTitle,
    companyName,
    companyUrl: companySite(input.companyUrl, input.text),
    jobStack: stackFrom(input.text, jobTitle),
    jobDescription: input.text.trim(),
  };
}

function stackFrom(text: string, title: string) {
  const found: string[] = [];
  for (const item of STACK) {
    if (item.name === "Spring" && found.includes("Spring Boot")) continue;
    if (mentioned(item, text) && !found.includes(item.name)) found.push(item.name);
    if (found.length >= 8) break;
  }
  if (found.length) return found.join(", ");
  if (/full[\s-]?stack/i.test(title)) return "Full Stack";
  if (/front[\s-]?end/i.test(title)) return "Frontend";
  if (/back[\s-]?end/i.test(title)) return "Backend";
  if (/\b(data|analytics|ml|machine learning)\b/i.test(title)) return "Data";
  if (/\b(devops|sre|platform|infrastructure)\b/i.test(title)) return "DevOps";
  if (/\b(ios|android|mobile)\b/i.test(title)) return "Mobile";
  return "Software";
}

function companySite(given: string | undefined, text: string) {
  const labeled = text.match(/\b(?:company\s+)?(?:website|homepage|site)\b\s*[:\-]\s*(https?:\/\/[^\s)<>"']+)/i)?.[1];
  const candidate = tidy(given) || tidy(labeled || "");
  if (!candidate || isJobBoardOrSocial(candidate)) return "(none)";
  return candidate;
}

function tidy(value: string | undefined) {
  const text = String(value || "").trim().replace(/[),.;]+$/, "");
  if (!/^https?:\/\//i.test(text)) return "";
  try {
    const url = new URL(text);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function clean(value: string) {
  return value.replace(/\s+/g, " ").replace(/^(company|title):\s*/i, "").trim();
}
