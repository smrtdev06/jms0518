// Creates demo accounts (the administrator comes from .env via db:init). Password for all: demo1234
//   demo_boss                       Boss — Dashboard of all members
//   demo_member, demo_member2, demo_member3   Members, each with a filled-in Resume Tailor profile
//   and for every member a team of 2 bidders and 2 callers who work only on that member's profile.
// Safe to re-run: existing demo users are reset (jobs are left alone).
// Usage: npm run db:demo
import "dotenv/config";
import pg from "pg";
import bcrypt from "bcryptjs";
import { databaseUrl } from "./db-url.mjs";

const PASSWORD = "demo1234";

const MEMBERS = [
  {
    username: "demo_member",
    display: "Demo Member",
    profile: {
      full_name: "Kevin Oyler",
      profile_label: "demo",
      phone: "+1 512 555 0142",
      email: "kevin.oyler@example.com",
      address: "Austin, United States",
      linkedin: "https://www.linkedin.com/in/kevin-oyler",
      experiences: [
        { jobTitle: "Senior Frontend Engineer", companyName: "Shopify", companyAddress: "Remote", startDate: "Mar 2021", endDate: "Present" },
        { jobTitle: "Frontend Engineer", companyName: "Atlassian", companyAddress: "Austin, United States", startDate: "Jun 2016", endDate: "Feb 2021" },
      ],
      education: [
        { universityName: "University of Texas at Austin", universityLocation: "Austin, United States", startDate: "Aug 2012", endDate: "May 2016", degree: "B.S. Computer Science" },
      ],
    },
    // Existing demo accounts keep their names.
    team: [
      ["demo_bidder", "Demo Bidder", "bidder"],
      ["demo_bidder2", "Liam Carter", "bidder"],
      ["demo_caller", "Demo Caller", "caller"],
      ["demo_caller2", "Ava Morgan", "caller"],
    ],
  },
  {
    username: "demo_member2",
    display: "Sophia Chen",
    profile: {
      full_name: "Sophia Chen",
      profile_label: "indeed",
      phone: "+1 206 555 0187",
      email: "sophia.chen@example.com",
      address: "Seattle, United States",
      linkedin: "https://www.linkedin.com/in/sophia-chen",
      experiences: [
        { jobTitle: "Senior Backend Engineer", companyName: "Amazon", companyAddress: "Seattle, United States", startDate: "Jan 2020", endDate: "Present" },
        { jobTitle: "Software Engineer", companyName: "Expedia", companyAddress: "Seattle, United States", startDate: "Jul 2016", endDate: "Dec 2019" },
      ],
      education: [
        { universityName: "University of Washington", universityLocation: "Seattle, United States", startDate: "Sep 2012", endDate: "Jun 2016", degree: "B.S. Computer Engineering" },
      ],
    },
    team: [
      ["demo2_bidder1", "Noah Bennett", "bidder"],
      ["demo2_bidder2", "Mia Patel", "bidder"],
      ["demo2_caller1", "Ethan Brooks", "caller"],
      ["demo2_caller2", "Olivia Reyes", "caller"],
    ],
  },
  {
    username: "demo_member3",
    display: "Marcus Reed",
    profile: {
      full_name: "Marcus Reed",
      profile_label: "linkedin",
      phone: "+1 312 555 0123",
      email: "marcus.reed@example.com",
      address: "Chicago, United States",
      linkedin: "https://www.linkedin.com/in/marcus-reed",
      experiences: [
        { jobTitle: "Senior Data Engineer", companyName: "Grubhub", companyAddress: "Remote", startDate: "Apr 2021", endDate: "Present" },
        { jobTitle: "Data Engineer", companyName: "Morningstar", companyAddress: "Chicago, United States", startDate: "Aug 2017", endDate: "Mar 2021" },
      ],
      education: [
        { universityName: "University of Illinois Urbana-Champaign", universityLocation: "Champaign, United States", startDate: "Aug 2013", endDate: "May 2017", degree: "B.S. Statistics and Computer Science" },
      ],
    },
    team: [
      ["demo3_bidder1", "Lucas Rivera", "bidder"],
      ["demo3_bidder2", "Emma Collins", "bidder"],
      ["demo3_caller1", "James Walker", "caller"],
      ["demo3_caller2", "Chloe Nguyen", "caller"],
    ],
  },
];

const client = new pg.Client({ connectionString: databaseUrl() });
await client.connect();
try {
  const hash = await bcrypt.hash(PASSWORD, 10);
  await client.query("BEGIN");

  const upsertUser = (username, name, role, memberId) =>
    client.query(
      `INSERT INTO users (username, password_hash, display_name, role, member_id) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, display_name = EXCLUDED.display_name,
         role = EXCLUDED.role, is_active = TRUE, member_id = EXCLUDED.member_id`,
      [username, hash, name, role, memberId],
    );

  await upsertUser("demo_boss", "Demo Boss", "boss", null);

  const lines = [];
  for (const m of MEMBERS) {
    const p = m.profile;
    // base_resume_text is left empty; the app builds it from the profile on first use.
    const member = await client.query(
      `INSERT INTO users (username, password_hash, display_name, role, profile_label, full_name, phone, email, address, linkedin,
                          experiences, education)
       VALUES ($1, $2, $3, 'member', $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, display_name = EXCLUDED.display_name,
         role = 'member', is_active = TRUE, member_id = NULL,
         profile_label = EXCLUDED.profile_label, full_name = EXCLUDED.full_name, phone = EXCLUDED.phone, email = EXCLUDED.email,
         address = EXCLUDED.address, linkedin = EXCLUDED.linkedin, experiences = EXCLUDED.experiences,
         education = EXCLUDED.education, base_resume_text = ''
       RETURNING id`,
      [m.username, hash, m.display, p.profile_label, p.full_name, p.phone, p.email, p.address, p.linkedin,
       JSON.stringify(p.experiences), JSON.stringify(p.education)],
    );
    const memberId = member.rows[0].id;
    lines.push(`  ${m.username.padEnd(14)} Member   ${p.full_name} (${p.profile_label})`);
    for (const [username, name, role] of m.team) {
      await upsertUser(username, name, role, memberId);
      lines.push(`    ${username.padEnd(12)} ${role === "bidder" ? "Bidder" : "Caller"}   ${name}`);
    }
  }
  await client.query("COMMIT");

  const admin = process.env.ADMIN_USERNAME || "admin";
  console.log(`Demo accounts ready (password ${PASSWORD}; ${admin}: ADMIN_PASSWORD in .env):`);
  console.log("  demo_boss      Boss     Dashboard of all members");
  console.log(lines.join("\n"));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
