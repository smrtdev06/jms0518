function firstName(fullName: string) {
  const token = fullName.trim().split(/\s+/)[0] || "Candidate";
  const cleaned = token.replace(/[\\/:*?"<>|]+/g, "").trim();
  return cleaned || "Candidate";
}

export function resumeFileName(fullName: string) {
  return `Resume-${firstName(fullName)}.pdf`;
}

export function coverFileName(fullName: string) {
  return `Coverletter-${firstName(fullName)}.pdf`;
}

export function zipFileName(company: string, jobTitle: string) {
  return `${filePart(company)}-${filePart(jobTitle)}.zip`;
}

// A name part that Windows accepts and that keeps extracted paths well under its 260-character limit.
function filePart(value: string) {
  const cleaned = value.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  // Cut by characters (not UTF-16 units) and drop trailing dots and spaces, which Windows does not allow.
  const short = Array.from(cleaned).slice(0, 60).join("").replace(/[. ]+$/, "");
  return short || "Untitled";
}
