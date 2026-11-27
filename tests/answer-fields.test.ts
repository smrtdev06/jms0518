import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { careerYears, modelAnswers, shapeAnswers, type AnswerProfile } from "../src/lib/tailor/answer-fields.ts";

const profile: AnswerProfile = {
  fullName: "Alex Morgan Lee",
  phone: "+1 555 0100",
  email: "alex@example.com",
  address: "Austin, TX, United States",
  linkedin: "https://linkedin.com/in/alex",
  company: "Acme Corp",
  years: "7",
};

const evidence = "Built services in TypeScript and Python. Deployed with Docker and Kubernetes. https://github.com/alex";

// The answer to question `n` (1-based) in shapeAnswers' "# Qn / # An" output.
function answer(output: string, n: number) {
  const match = new RegExp(`# A${n}\\n([\\s\\S]*?)(?=\\n\\n# Q\\d+\\n|$)`).exec(output);
  return match ? match[1].trim() : undefined;
}

function shape(questions: string[], reply: string) {
  const text = questions.map((question, index) => `${index + 1}. ${question}`).join("\n\n");
  return shapeAnswers(reply, text, profile, evidence);
}

describe("modelAnswers", () => {
  it("reads '# A1' heading blocks", () => {
    const reply = "# Q1\nWhy us?\n\n# A1\nBecause of the mission.\n\n# Q2\nStart date?\n\n# A2\nTwo weeks.";
    assert.deepEqual(modelAnswers(reply, ["Why us?", "Start date?"]), ["Because of the mission.", "Two weeks."]);
  });

  it("reads answers written on the same line as the marker", () => {
    const reply = "A1: Remote\nA2: Yes";
    assert.deepEqual(modelAnswers(reply, ["Location preference?", "Willing to travel?"]), ["Remote", "Yes"]);
  });

  it("falls back to a numbered list", () => {
    const reply = "1. First answer\n2. Second answer";
    assert.deepEqual(modelAnswers(reply, ["One?", "Two?"]), ["First answer", "Second answer"]);
  });

  it("leaves a missing answer empty instead of shifting the others", () => {
    const reply = "# A2\nOnly the second.";
    assert.deepEqual(modelAnswers(reply, ["One?", "Two?"]), ["", "Only the second."]);
  });
});

describe("shapeAnswers", () => {
  it("fills contact fields from the profile, whatever the model wrote", () => {
    const out = shape(["First name (text)", "Last name (text)", "Email (email)", "Phone (tel)", "Resume (file)"], "# A1\nwrong\n# A2\nwrong\n# A3\nwrong\n# A4\nwrong\n# A5\nwrong");
    assert.equal(answer(out, 1), "Alex");
    assert.equal(answer(out, 2), "Morgan Lee");
    assert.equal(answer(out, 3), "alex@example.com");
    assert.equal(answer(out, 4), "+1 555 0100");
    assert.equal(answer(out, 5), "FILE");
  });

  it("never invents work authorization or visa answers", () => {
    const questions = [
      "Are you legally authorized to work in the United States? (radio) Options: Yes | No",
      "Will you now or in the future require visa sponsorship? (radio) Options: Yes | No",
    ];
    const blank = shape(questions, "");
    assert.equal(answer(blank, 1), "");
    assert.equal(answer(blank, 2), "");
    // The model's own answer is kept.
    const written = shape(questions, "# A1\nNo\n# A2\nYes");
    assert.equal(answer(written, 1), "No");
    assert.equal(answer(written, 2), "Yes");
  });

  it("answers Yes to an experience question only with evidence in the resume", () => {
    const questions = [
      "Do you have experience developing Kubernetes operators? (radio) Options: Yes | No",
      "Do you have experience developing Salesforce integrations? (radio) Options: Yes | No",
    ];
    const out = shape(questions, "");
    assert.equal(answer(out, 2), "", "no evidence: nothing is forced");
    const written = shape(questions, "# A1\nNo\n# A2\nNo");
    assert.equal(answer(written, 2), "No", "the model's answer is kept");
  });

  it("picks the decline option for self-identification questions", () => {
    const out = shape(["Gender (select) Options: Male | Female | I prefer not to answer"], "");
    assert.equal(answer(out, 1), "I prefer not to answer");
  });

  it("matches the model's answer to a listed option", () => {
    const out = shape(["Preferred work setting (select) Options: Remote | Hybrid | On-site"], "# A1\nI'd prefer hybrid.");
    assert.equal(answer(out, 1), "Hybrid");
  });
});

describe("careerYears", () => {
  it("counts from the earliest start to the latest end", () => {
    assert.equal(careerYears([
      { startDate: "Jan 2020", endDate: "Jan 2024" },
      { startDate: "Mar 2016", endDate: "Dec 2019" },
    ]), "8");
  });

  it("is empty without dates", () => {
    assert.equal(careerYears([{ startDate: "", endDate: "" }]), "");
  });
});
