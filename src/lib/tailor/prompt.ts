import type { EducationInput, Experience, ExperienceInput } from "./types";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const DATE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}$/;

const PLACE = /^[\p{L}\p{M} .'’-]+,\s*[\p{L}\p{M} .'’-]+$/u;

function chooseBulletCount(index: number, startDate: string, endDate: string) {
  const years = durationYears(startDate, endDate);
  const current = /^present$/i.test(endDate.trim());
  // Every role gets 3 to 6 bullets; recent and longer roles get more.
  let count: number;
  if (index === 0) count = current || years >= 3 ? 6 : years >= 1.5 ? 5 : 4;
  else if (index === 1) count = years >= 4 ? 6 : years >= 2 ? 5 : 4;
  else if (index === 2) count = years >= 2 ? 5 : 4;
  else if (index === 3) count = 4;
  else count = 3;
  return Math.max(3, Math.min(6, count));
}

export function withBulletCounts(experiences: ExperienceInput[]): Experience[] {
  return experiences.map((experience, index) => ({
    ...experience,
    endDate: /^present$/i.test(experience.endDate.trim()) ? "Present" : experience.endDate.trim(),
    bulletCount: chooseBulletCount(index, experience.startDate, experience.endDate),
  }));
}

export function validateProfileInput(body: {
  fullName?: string;
  phone?: string;
  email?: string;
  address?: string;
  linkedin?: string;
  experiences?: ExperienceInput[];
  education?: EducationInput[];
}) {
  const fullName = clean(body.fullName);
  const phone = clean(body.phone);
  const email = clean(body.email);
  const address = clean(body.address);
  const linkedin = normalizeLinkedIn(clean(body.linkedin));
  if (fullName.split(/\s+/).length < 2) return { error: "Enter your full name." };
  const phoneDigits = phone.replace(/\D/g, "").length;
  if (!/^\+\d[\d ().-]*\d$/.test(phone) || phoneDigits < 7 || phoneDigits > 15) {
    return { error: "Phone number must start with + and a country code, such as +40 373 806 070." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address." };
  if (!PLACE.test(address)) {
    return { error: "Address must be a city and country, such as Bucharest, Romania." };
  }
  if (!linkedin) return { error: "Enter a LinkedIn profile URL." };

  const experiences = Array.isArray(body.experiences) ? body.experiences : [];
  const education = Array.isArray(body.education) ? body.education : [];
  if (!experiences.length) return { error: "Add at least one work experience." };
  if (!education.length) return { error: "Add at least one education entry." };

  const cleanExperiences: ExperienceInput[] = [];
  for (const [index, item] of experiences.entries()) {
    const jobTitle = clean(item?.jobTitle);
    const companyName = clean(item?.companyName);
    const companyAddress = clean(item?.companyAddress);
    const startDate = clean(item?.startDate);
    const endDate = /^present$/i.test(clean(item?.endDate)) ? "Present" : clean(item?.endDate);
    const label = `Experience ${index + 1}`;
    if (!jobTitle || !companyName) return { error: `${label} needs a job title and company name.` };
    if (!companyAddress || (!/^remote$/i.test(companyAddress) && !PLACE.test(companyAddress))) {
      return { error: `${label} address must be a city and country, or Remote.` };
    }
    if (!DATE.test(startDate)) return { error: `${label} start date must look like Sep 2015.` };
    if (endDate !== "Present" && !DATE.test(endDate)) return { error: `${label} end date must look like Apr 2023, or Present.` };
    if (endDate !== "Present" && durationYears(startDate, endDate) < 0) {
      return { error: `${label} end date is before the start date.` };
    }
    cleanExperiences.push({
      jobTitle,
      companyName,
      companyAddress: /^remote$/i.test(companyAddress) ? "Remote" : companyAddress,
      startDate,
      endDate,
    });
  }

  const cleanEducation: EducationInput[] = [];
  for (const [index, item] of education.entries()) {
    const universityName = clean(item?.universityName);
    const universityLocation = clean(item?.universityLocation);
    const startDate = clean(item?.startDate);
    const endDate = clean(item?.endDate);
    const degree = clean(item?.degree);
    const label = `Education ${index + 1}`;
    if (!universityName || !degree) return { error: `${label} needs a university and a degree.` };
    if (!PLACE.test(universityLocation)) {
      return { error: `${label} location must be a city and country.` };
    }
    if (!DATE.test(startDate)) return { error: `${label} start date must look like Aug 2008.` };
    if (!DATE.test(endDate)) return { error: `${label} end date must look like Dec 2013.` };
    if (durationYears(startDate, endDate) < 0) return { error: `${label} end date is before the start date.` };
    cleanEducation.push({ universityName, universityLocation, startDate, endDate, degree });
  }

  return {
    value: {
      fullName,
      phone,
      email,
      address,
      linkedin,
      experiences: withBulletCounts(cleanExperiences),
      education: cleanEducation,
    },
  };
}

function durationYears(startDate: string, endDate: string) {
  const start = parseMonth(startDate);
  const end = /^present$/i.test(endDate.trim())
    ? { year: new Date().getFullYear(), month: new Date().getMonth() }
    : parseMonth(endDate);
  if (!start || !end) return 2;
  return (end.year - start.year) + (end.month - start.month) / 12;
}

function parseMonth(value: string) {
  const match = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/i.exec(value.trim());
  if (!match) return null;
  return { month: MONTHS.indexOf(match[1].toLowerCase()), year: Number(match[2]) };
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeLinkedIn(value: string) {
  if (!value) return "";
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withProtocol);
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname.replace(/^www\./, ""))) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}
