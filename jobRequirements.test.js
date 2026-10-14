const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getJobRequirements,
  prependJobRequirements,
} = require("./jobRequirements.js");

test("puts a specific clearance at the beginning", () => {
  const description = "Qualifications\nActive TS/SCI with CI polygraph is required.\nBuild software.";
  const result = prependJobRequirements(description);

  assert.equal(
    result,
    `Clearance required: TS/SCI with polygraph\n\n${description}`
  );
});

test("puts an explicitly required location at the beginning", () => {
  const description = "Candidates must be located in Austin, TX. This is a remote role.";
  const result = prependJobRequirements(description);

  assert.equal(
    result,
    `Location required: Austin, TX\n\n${description}`
  );
});

test("includes clearance and location together", () => {
  const description = "Secret clearance required. You must work onsite in Arlington, VA.";
  const requirements = getJobRequirements(description);

  assert.deepEqual(requirements, {
    clearances: ["Secret"],
    locations: ["Arlington, VA"],
  });
});

test("ignores a negated clearance and an ordinary location mention", () => {
  const descriptions = [
    "No security clearance is required. Our company was founded in Denver.",
    "This role requires no security clearance. Our office is in Denver.",
    "A security clearance is not required. Our office is in Denver.",
  ];

  for (const description of descriptions) {
    assert.equal(prependJobRequirements(description), description);
  }
});

test("detects relocation requirements", () => {
  const description = "Relocation to Huntsville, Alabama is required upon hire.";

  assert.deepEqual(getJobRequirements(description).locations, ["Huntsville, Alabama"]);
});
