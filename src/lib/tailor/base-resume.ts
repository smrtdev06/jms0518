import type { Profile } from "./types";

const SHORT = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Dated = { startDate: string };

// Most recent start date first. The same order is used for the stored text and for the PDF,
// so each tailored role lines up with the job it describes.
export function byRecency<T extends Dated>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const delta = monthIndex(b.item.startDate) - monthIndex(a.item.startDate);
      return delta || a.index - b.index;
    })
    .map(({ item }) => item);
}

export function yearsOfExperience(experiences: Dated[], today = new Date()) {
  const starts = experiences.map((item) => monthIndex(item.startDate)).filter((value) => value > 0);
  if (!starts.length) return 0;
  const earliest = Math.min(...starts);
  const now = today.getFullYear() * 12 + today.getMonth();
  return Math.max(0, Math.floor((now - earliest) / 12));
}

export function formatRunDate(today = new Date()) {
  return `${FULL[today.getMonth()].slice(0, 3)} ${today.getFullYear()}`;
}

export function buildBaseResumeText(profile: Omit<Profile, "baseResumeText">) {
  const personal = [
    "PERSONAL INFORMATION",
    "",
    `Full Name: ${profile.fullName}`,
    `Phone: ${profile.phone}`,
    `Email: ${profile.email}`,
    `LinkedIn: ${profile.linkedin}`,
    `Location: ${profile.address}`,
  ].join("\n");

  const jobs = byRecency(profile.experiences).map((job) =>
    [
      `Job Title: ${job.jobTitle}`,
      `Company: ${job.companyName}`,
      `Location: ${job.companyAddress}`,
      `Start Date: ${fullDate(job.startDate)}`,
      `End Date: ${fullDate(job.endDate)}`,
    ].join("\n"),
  );
  const schools = profile.education.map((school) =>
    [
      `Degree: ${school.degree}`,
      `University: ${school.universityName}`,
      `Location: ${school.universityLocation}`,
      `Start Date: ${fullDate(school.startDate)}`,
      `End Date: ${fullDate(school.endDate)}`,
    ].join("\n"),
  );

  return [
    personal,
    ["WORK EXPERIENCE", "", jobs.join("\n\n")].join("\n"),
    ["EDUCATION", "", schools.join("\n\n")].join("\n"),
  ].join("\n\n");
}

function fullDate(value: string) {
  const text = value.trim();
  if (/^present$/i.test(text)) return "Present";
  const match = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/i.exec(text);
  if (!match) return text;
  return `${FULL[SHORT.indexOf(match[1].toLowerCase())]} ${match[2]}`;
}

function monthIndex(value: string) {
  const match = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/i.exec(value.trim());
  if (!match) return 0;
  return Number(match[2]) * 12 + SHORT.indexOf(match[1].toLowerCase());
}

