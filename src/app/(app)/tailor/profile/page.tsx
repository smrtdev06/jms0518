import { can, requirePageUser } from "@/lib/auth";
import { loadProfile } from "@/lib/tailor/profile";
import { ProfileForm } from "./profile-form";

export const metadata = { title: "Profile · Resume Tailor" };

export default async function TailorProfilePage() {
  const user = await requirePageUser(can.tailor);
  const profile = await loadProfile(user.id);
  if (!profile) return <ProfileForm />;
  const { fullName, phone, email, address, linkedin, experiences, education } = profile;
  return (
    <ProfileForm
      initial={{
        fullName,
        phone,
        email,
        address,
        linkedin,
        experiences: experiences.map(({ jobTitle, companyName, companyAddress, startDate, endDate }) => ({ jobTitle, companyName, companyAddress, startDate, endDate })),
        education: education.map(({ universityName, universityLocation, startDate, endDate, degree }) => ({ universityName, universityLocation, startDate, endDate, degree })),
      }}
    />
  );
}
