// Turns the model's reply to the screening questions into one answer per question. The model writes the prose;
// choice, file and profile fields are then forced into a value the application form can submit.
// No database or network here, so this is unit-tested (tests/answer-fields.test.ts).

export type AnswerProfile = { fullName: string; phone: string; email: string; address: string; linkedin: string; company: string; years: string };

export function shapeAnswers(modelText: string, questionsText: string, profile: AnswerProfile, evidence: string) {
  const questions = questionsText.split(/\n\s*\n/).map((item) => item.replace(/^\d+\.\s+/, "").trim()).filter(Boolean);
  const written = modelAnswers(modelText, questions);
  return questions
    .map((question, index) => {
      const answer = fieldAnswer(question, written[index] || "", profile, evidence);
      return `# Q${index + 1}\n${question}\n\n# A${index + 1}\n${answer}`;
    })
    .join("\n\n");
}

export function modelAnswers(text: string, questions: string[]) {
  const body = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/^```[a-z]*\n?|\n?```$/gim, "").trim();
  const marks = [...body.matchAll(/^#{0,3}\s*([QA])\s*(\d+)\b[^\n]*$/gim)];
  const slots = new Map<number, string>();
  const take = (number: number, value: string) => {
    const answer = value.trim();
    if (!number || !answer || slots.has(number)) return;
    slots.set(number, answer);
  };
  for (let i = 0; i < marks.length; i += 1) {
    const kind = marks[i][1].toUpperCase();
    const number = Number(marks[i][2]);
    const sameLine = marks[i][0].replace(/^#{0,3}\s*[QA]\s*\d+\s*[:.\-)]?\s*/i, "").trim();
    const start = (marks[i].index ?? 0) + marks[i][0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index ?? body.length : body.length;
    const following = body.slice(start, end).trim();
    if (kind === "A") take(number, [sameLine, following].filter(Boolean).join("\n"));
    else if (!marks.some((mark) => mark[1].toUpperCase() === "A" && Number(mark[2]) === number)) {
      const question = questions[number - 1] || "";
      const echoed = question && following.startsWith(question) ? following.slice(question.length) : following;
      take(number, echoed);
    }
  }
  if ([...slots.values()].filter(Boolean).length < questions.length) {
    const blocks = body.split(/^\d+\.\s+/m).slice(1);
    blocks.forEach((block, index) => {
      const lines = block.trim().split("\n");
      const echoed = questions[index] && lines[0]?.includes(questions[index].slice(0, 24));
      const answer = (echoed ? lines.slice(1) : lines).join("\n").trim();
      take(index + 1, answer);
    });
  }
  const count = Math.max(questions.length, ...slots.keys(), 0);
  return Array.from({ length: count }, (_, index) => slots.get(index + 1) || "");
}

function fieldAnswer(question: string, written: string, profile: AnswerProfile, evidence: string) {
  const kind = question.match(/\((file|text|email|textarea|radio|select|checkbox|tel|url)\)/i)?.[1].toLowerCase() || "";
  if (kind === "file") return "FILE";
  const label = question.split("(")[0].replace(/\s*\*+\s*$/g, "").trim();
  const saved = profileFact(label, kind, profile, evidence);
  if (saved) return saved;

  const options = listedOptions(question);
  const standard = screeningDefault(label, profile, evidence);
  if (options.length && kind !== "textarea" && kind !== "text") {
    const skill = skillChoice(question, evidence);
    if (skill) return optionText(options, skill) || skill;
    const chosen = optionText(options, written);
    if (chosen) return chosen;
    const fallback = standard ? optionText(options, standard) || (selfIdentify(label) ? declineOption(options) : "") : "";
    if (fallback) return fallback;
  }
  if (standard && !written.trim()) return standard;
  if (standard && kind !== "textarea" && kind !== "text" && written.trim().length > 80) return standard;
  return written.trim();
}

function selfIdentify(label: string) {
  return /gender|transgender|sexual orientation|race|ethnicity|veteran|disability|hispanic|latino/i.test(label);
}

function screeningDefault(label: string, profile: AnswerProfile, evidence: string) {
  if (selfIdentify(label)) return "I don't wish to answer";
  if (/how did you hear|where did you hear|how did you find|referral source|source of (this )?(application|opportunity)/i.test(label)) {
    return profile.linkedin ? "LinkedIn" : "Job board";
  }
  // Work authorization and visa sponsorship are legal statements the profile does not record, so they are never
  // filled in here (an address or phone number says nothing about them); the model's answer is kept as written.
  if (/\b(ever|currently)\b/i.test(label) && /\b(work|employ|employee|contingent)\b/i.test(label)) {
    const names = namedEmployers(label);
    if (!names.length) return "";
    const hay = `${profile.company}\n${evidence}`.toLowerCase();
    return names.some((name) => hay.includes(name.toLowerCase())) ? "Yes" : "No";
  }
  if (/\b(website|portfolio|personal site|personal website|url)\b/i.test(label) && !/linkedin/i.test(label)) return "N/A";
  if (/how many years|years of (professional |work |working )?experience/i.test(label)) return profile.years;
  return experienceFallback(label, evidence);
}

// "Do you have experience with X?" is answered Yes only when the resume shows X. Without that evidence nothing is
// forced (not even No): the model's answer, written from the resume, is kept.
function experienceFallback(label: string, evidence: string) {
  if (!/\b(do you have|have you)\b/i.test(label) || !/\bexperience\b/i.test(label) || /how many years/i.test(label)) return "";
  if (/\blanguage/i.test(label) && /\b(javascript|typescript|python|java|sql|golang|ruby|php|c\+\+|c#)\b/i.test(evidence)) return "Yes";
  if (/\b(ai|artificial intelligence|machine learning)\b/i.test(label) && /\b(ai|artificial intelligence|machine learning|llms?)\b/i.test(evidence)) return "Yes";
  const topic = label.replace(/\([^)]*\)/g, " ").replace(/\bif so\b.*$/i, "").replace(/\bplease\b.*$/i, "");
  const words = topic.match(/\b[a-z][a-z0-9+#.]{2,}\b/gi)?.filter((word) => !/^(the|and|with|any|for|your|this|that|have|has|you|professional|working|experience|building|coding|listed|below|select|systems|features|tools|using|in|of|do|developing|years?)$/i.test(word)) || [];
  if (words.length && words.every((word) => usedSkill(evidence, word))) return "Yes";
  return "";
}

export function careerYears(roles: { startDate: string; endDate: string }[]) {
  let start = Number.POSITIVE_INFINITY;
  let end = 0;
  for (const role of roles) {
    const opened = timeOf(role.startDate);
    const closed = /present|current|now/i.test(role.endDate || "") ? Date.now() : timeOf(role.endDate);
    if (opened) start = Math.min(start, opened);
    if (closed) end = Math.max(end, closed);
  }
  if (!Number.isFinite(start) || !end || end < start) return "";
  return String(Math.max(1, Math.round((end - start) / (365.25 * 24 * 60 * 60 * 1000))));
}

function timeOf(value: string) {
  const text = String(value || "").trim();
  const year = text.match(/\b(19|20)\d{2}\b/);
  if (!year) return 0;
  const monthName = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i)?.[1].toLowerCase() || "";
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const month = Math.max(0, months.indexOf(monthName));
  return Date.UTC(Number(year[0]), month, 1);
}

function namedEmployers(label: string) {
  const skip = /^(Have|Are|Will|How|The|This|Any|You|Your|Please|Select|Mark|All|That|Apply|Employee|Contingent|Worker|Capacity|Ever|Currently|Working|Future|Require|Visa|Sponsorship|Employment|Country|Where|Now|One|Identity|Describe|Would)$/i;
  return [...label.matchAll(/\b[A-Z][A-Za-z0-9&.'’-]{2,}(?:\s+[A-Z][A-Za-z0-9&.'’-]{2,})*/g)]
    .map((match) => match[0])
    .filter((name) => !skip.test(name));
}

function declineOption(options: string[]) {
  return options.find((option) => /don'?t wish|do not wish|prefer not|rather not|decline to|wish not/i.test(option)) || "";
}

function profileFact(label: string, kind: string, profile: AnswerProfile, evidence: string) {
  if (/first name|given name|preferred name/i.test(label)) return firstName(profile.fullName);
  if (/last name|family name|surname/i.test(label)) return lastName(profile.fullName);
  if (/^(full |legal |your )?name$/i.test(label)) return profile.fullName;
  if (/e-?mail/i.test(label) || kind === "email") return profile.email;
  if (/\b(phone|mobile|cell|telephone)\b/i.test(label) || kind === "tel") return profile.phone;
  if (/\b(location|city|address)\b/i.test(label) && !/\b(email|start|date|website|url|country)\b/i.test(label)) return profile.address;
  if (/^country$|country of (residence|citizenship)|country\/region/i.test(label)) return countryName(profile.address);
  if (/linkedin/i.test(label)) return profile.linkedin || "N/A";
  if (/\bgithub\b/i.test(label)) return firstUrl(evidence, /github\.com/i) || "N/A";
  if (/\b(current company|current employer|employer|company name)\b/i.test(label)) return profile.company;
  return "";
}

function firstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] || "";
}

function lastName(fullName: string) {
  return fullName.trim().split(/\s+/).slice(1).join(" ");
}

function countryName(address: string) {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  return parts[parts.length - 1] || "";
}

function listedOptions(question: string) {
  const match = question.match(/Options:\s*(.+)$/i);
  if (!match) return [];
  return match[1].split("|").map((item) => item.trim()).filter(Boolean);
}

function optionText(options: string[], answer: string) {
  const wanted = answer.trim().toLowerCase();
  if (!wanted) return "";
  const wantedPattern = new RegExp(`\\b${wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return options.find((option) => option.toLowerCase() === wanted)
    || options.find((option) => new RegExp(`\\b${option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(answer))
    || options.find((option) => wantedPattern.test(option));
}

// "Docker and Linux" is Yes only when every named skill was used in the source resume or a bullet.
function skillChoice(question: string, evidence: string) {
  const ask = question.replace(/\([^)]*\)\.?/g, " ").replace(/\brequired\b\.?/gi, " ").replace(/options:.*$/i, "").replace(/\s+/g, " ").trim();
  const skills = ask.match(/\b(?:working with|experience (?:with|in|using))\s+(.+?)\??$/i)?.[1];
  if (!skills) return "";
  const parts = skills.split(/\s+and\s+/i).map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return "";
  return parts.every((part) => usedSkill(evidence, part)) ? "Yes" : "No";
}

function usedSkill(evidence: string, skill: string) {
  const term = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = /[#.+]/.test(skill) ? new RegExp(term, "i") : new RegExp(`\\b${term}\\b`, "i");
  return pattern.test(evidence);
}

function firstUrl(text: string, host: RegExp) {
  for (const match of text.matchAll(/https?:\/\/[^\s)]+/gi)) {
    const url = match[0].replace(/[.,)]+$/, "");
    if (host.test(url)) return url;
  }
  return "";
}

