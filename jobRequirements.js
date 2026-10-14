(function (root) {
  "use strict";

  const CLEARANCE_PATTERNS = [
    {
      label: "TS/SCI with polygraph",
      pattern: /\b(?:TS\s*\/\s*SCI|top secret\s*\/\s*sensitive compartmented information)\b[^\n.;]{0,45}\b(?:full[- ]scope|counterintelligence|CI)?\s*poly(?:graph)?\b/gi,
    },
    {
      label: "TS/SCI",
      pattern: /\b(?:TS\s*\/\s*SCI|top secret\s*\/\s*sensitive compartmented information)\b/gi,
    },
    { label: "Top Secret", pattern: /\btop secret(?:\s+clearance)?\b/gi },
    { label: "Secret", pattern: /\bsecret\s+clearance\b/gi },
    { label: "DOE Q clearance", pattern: /\b(?:DOE\s+)?Q\s+clearance\b/gi },
    { label: "DOE L clearance", pattern: /\b(?:DOE\s+)?L\s+clearance\b/gi },
    { label: "Public Trust", pattern: /\bpublic trust(?:\s+clearance)?\b/gi },
    { label: "Confidential", pattern: /\bconfidential\s+clearance\b/gi },
    {
      label: "Security clearance",
      pattern: /\b(?:government|federal|DoD|security)\s+clearance\b/gi,
    },
  ];

  const LOCATION_PATTERNS = [
    /\b(?:must|required to|needs? to|expected to)\s+(?:currently\s+)?(?:be\s+)?(?:located|based|reside|live)\s+(?:in|within|near)\s+([^\n.;]{2,100})/gi,
    /\b(?:candidate|applicant|employee|position|role)\s+(?:must\s+be|is)\s+(?:located|based)\s+(?:in|within|near)\s+([^\n.;]{2,100})/gi,
    /\b(?:must|required to|needs? to)\s+(?:work\s+)?(?:on[- ]?site|in[- ]office|hybrid)\s+(?:in|at|within|near)\s+([^\n.;]{2,100})/gi,
    /\b(?:must|required to|needs? to)\s+be\s+within\s+commuting distance\s+(?:of|to)\s+([^\n.;]{2,100})/gi,
    /\brelocation\s+to\s+([^\n.;]{2,100}?)\s+(?:is\s+)?required\b/gi,
  ];

  const NEGATED_CLEARANCE = /\b(?:requires?|requiring|with)\s+no\s+(?:active\s+|current\s+)?(?:security\s+)?clearance\b|\bno\s+(?:active\s+|current\s+)?(?:security\s+)?clearance\s+(?:is\s+)?required\b|\bclearance\s+(?:is\s+)?not\s+required\b|\bdoes\s+not\s+require\b|\bwithout\s+(?:a\s+)?clearance\b/i;

  function isNegatedMatch(text, index, length) {
    const context = text.slice(Math.max(0, index - 55), index + length + 55);
    return NEGATED_CLEARANCE.test(context);
  }

  function extractClearances(text) {
    const clearances = [];
    let coveredRanges = [];

    for (const { label, pattern } of CLEARANCE_PATTERNS) {
      pattern.lastIndex = 0;
      let match;

      while ((match = pattern.exec(text)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        const overlapsStrongerMatch = coveredRanges.some(
          (range) => start >= range.start && end <= range.end
        );

        if (!overlapsStrongerMatch && !isNegatedMatch(text, start, match[0].length)) {
          if (!clearances.includes(label)) {
            clearances.push(label);
          }
          coveredRanges.push({ start, end });
        }

        if (match[0].length === 0) {
          pattern.lastIndex += 1;
        }
      }
    }

    return clearances;
  }

  function cleanLocation(value) {
    return value
      .replace(/\s+/g, " ")
      .replace(/\s+(?:and|but)\s+(?:must|will|should|requires?|needs?|is)\b.*$/i, "")
      .replace(/\s+(?:for this|to be considered|upon hire)\b.*$/i, "")
      .replace(/[,:\-\s]+$/g, "")
      .trim();
  }

  function extractRequiredLocations(text) {
    const locations = [];

    for (const pattern of LOCATION_PATTERNS) {
      pattern.lastIndex = 0;
      let match;

      while ((match = pattern.exec(text)) !== null) {
        const location = cleanLocation(match[1]);
        if (location && !locations.some((item) => item.toLowerCase() === location.toLowerCase())) {
          locations.push(location);
        }

        if (match[0].length === 0) {
          pattern.lastIndex += 1;
        }
      }
    }

    return locations;
  }

  function getJobRequirements(text) {
    const normalizedText = typeof text === "string" ? text : "";
    return {
      clearances: extractClearances(normalizedText),
      locations: extractRequiredLocations(normalizedText),
    };
  }

  function prependJobRequirements(text) {
    const requirements = getJobRequirements(text);
    const summary = [];

    if (requirements.clearances.length) {
      summary.push(`Clearance required: ${requirements.clearances.join(", ")}`);
    }
    if (requirements.locations.length) {
      summary.push(`Location required: ${requirements.locations.join("; ")}`);
    }

    if (!summary.length) {
      return text;
    }

    return `${summary.join("\n")}\n\n${text}`;
  }

  const api = { getJobRequirements, prependJobRequirements };
  root.JobRequirementSummary = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
