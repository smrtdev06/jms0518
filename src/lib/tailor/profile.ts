import { query } from "@/lib/db";
import { buildBaseResumeText } from "./base-resume";
import { withBulletCounts } from "./prompt";
import type { Education, Experience, Profile, PublicProfile } from "./types";

// A member's resume tailor profile lives in their users row.

type TailorProfile = PublicProfile & { baseResumeText: string };

type ProfileRow = {
  full_name: string | null;
  phone: string;
  email: string;
  address: string;
  linkedin: string;
  experiences: Experience[] | null;
  education: Education[] | null;
  base_resume_text: string;
};

export async function loadProfile(userPk: number): Promise<TailorProfile | null> {
  const rows = await query<ProfileRow>(
    "SELECT full_name, phone, email, address, linkedin, experiences, education, base_resume_text FROM users WHERE id = $1",
    [userPk],
  );
  const row = rows[0];
  if (!row?.full_name) return null;
  const experiences = withBulletCounts(row.experiences || []);
  const facts: Omit<Profile, "baseResumeText"> = {
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    linkedin: row.linkedin,
    experiences,
    education: row.education || [],
  };
  let baseResumeText = row.base_resume_text || "";
  if (!baseResumeText.trim() || /\nSKILLS\n/.test(baseResumeText)) {
    baseResumeText = buildBaseResumeText(facts);
    await query("UPDATE users SET base_resume_text = $2 WHERE id = $1", [userPk, baseResumeText]);
  }
  return { ...facts, headline: experiences[0]?.jobTitle || "Software Engineer", baseResumeText };
}

// Saves the profile fields and the plain-text resume built from them.
export async function saveProfile(userPk: number, profile: Omit<Profile, "baseResumeText">) {
  await query(
    `UPDATE users SET full_name = $2, phone = $3, email = $4, address = $5, linkedin = $6,
       experiences = $7::jsonb, education = $8::jsonb, base_resume_text = $9
     WHERE id = $1`,
    [
      userPk,
      profile.fullName,
      profile.phone,
      profile.email,
      profile.address,
      profile.linkedin,
      JSON.stringify(profile.experiences),
      JSON.stringify(profile.education),
      buildBaseResumeText(profile),
    ],
  );
}
