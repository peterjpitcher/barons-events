import "server-only";

export type WebsiteCopyInput = {
  title: string;
  eventType: string;
  startAt: string;
  endAt: string;
  venueName: string | null;
  venueAddress: string | null;
  venueSpaces: string[];
  expectedHeadcount: number | null;
  wetPromo: string | null;
  foodPromo: string | null;
  details: string | null;
};

export type GeneratedWebsiteCopy = {
  publicTitle: string;
  publicDescription: string;
  publicTeaser: string;
  seoTitle: string;
  seoDescription: string;
  seoSlug: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"]
  ];
  for (const [open, close] of pairs) {
    if (trimmed.startsWith(open) && trimmed.endsWith(close) && trimmed.length >= open.length + close.length + 1) {
      return trimmed.slice(open.length, -close.length).trim();
    }
  }
  return trimmed;
}

function clampChars(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const sliced = trimmed.slice(0, maxChars);
  const lastSpace = sliced.lastIndexOf(" ");
  if (lastSpace > 0 && lastSpace > maxChars - 20) {
    return sliced.slice(0, lastSpace).trim();
  }
  return sliced.trim();
}

function formatUkDate(startAt: string): string | null {
  const parsed = new Date(startAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  })
    .format(parsed)
    .replace(",", "");
}

function formatUkTime(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  })
    .format(parsed)
    .replace(" ", "")
    .toLowerCase();
}

function formatUkTimeRange(startAt: string, endAt: string): string | null {
  const start = formatUkTime(startAt);
  const end = formatUkTime(endAt);
  if (!start || !end) return null;
  return `${start}\u2013${end}`;
}

function buildWebsiteCopyPrompt(input: WebsiteCopyInput): string {
  const startIso = new Date(input.startAt).toISOString();
  const endIso = new Date(input.endAt).toISOString();
  const ukDate = formatUkDate(input.startAt);
  const ukTimeRange = formatUkTimeRange(input.startAt, input.endAt);
  const lines = [
    `Event title (internal): ${input.title}`,
    `Event type: ${input.eventType}`,
    `Venue name (use for the location): ${input.venueName ?? "Not provided"}`,
    input.venueAddress ? `Venue address: ${input.venueAddress}` : `Venue address: Not provided`,
    input.venueSpaces.length ? `Venue spaces: ${input.venueSpaces.join(", ")}` : "Venue spaces: Not specified",
    ukDate ? `Date (UK): ${ukDate}` : "Date (UK): Not provided",
    ukTimeRange ? `Time (UK): ${ukTimeRange}` : "Time (UK): Not provided",
    `Start (UTC): ${startIso}`,
    `End (UTC): ${endIso}`,
    typeof input.expectedHeadcount === "number" ? `Expected headcount: ${input.expectedHeadcount}` : "Expected headcount: Not provided",
    input.wetPromo ? `Wet promotion (only mention if present): ${input.wetPromo}` : "Wet promotion: Not provided",
    input.foodPromo ? `Food promotion (only mention if present): ${input.foodPromo}` : "Food promotion: Not provided",
    input.details ? `Event details: ${input.details}` : "Event details: Not provided"
  ];
  return lines.join("\n");
}

function parseWebsiteCopy(content: unknown): GeneratedWebsiteCopy | null {
  if (typeof content !== "string") return null;
  try {
    const data = JSON.parse(content);
    if (
      typeof data.publicTitle === "string" &&
      typeof data.publicDescription === "string" &&
      typeof data.publicTeaser === "string" &&
      typeof data.seoTitle === "string" &&
      typeof data.seoDescription === "string" &&
      typeof data.seoSlug === "string"
    ) {
      return {
        publicTitle: data.publicTitle.trim(),
        publicDescription: data.publicDescription.trim(),
        publicTeaser: data.publicTeaser.trim(),
        seoTitle: data.seoTitle.trim(),
        seoDescription: data.seoDescription.trim(),
        seoSlug: data.seoSlug.trim()
      };
    }
  } catch (error) {
    console.error("Failed to parse AI website copy response", error);
  }
  return null;
}

function sanitiseSeoSlug(value: string): string {
  const normalised = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return normalised.length ? normalised : "event";
}

function clampWords(value: string, maxWords: number): string {
  const words = value
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length <= maxWords) return value.trim();
  return words.slice(0, maxWords).join(" ").trim();
}

function stripUrls(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim();
}

export async function generateWebsiteCopy(input: WebsiteCopyInput): Promise<GeneratedWebsiteCopy | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("OPENAI_API_KEY is not set. Skipping AI website copy generation.");
    return null;
  }

  const body = {
    model: process.env.OPENAI_WEBSITE_COPY_MODEL ?? "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          [
            "You are a UK hospitality marketing copywriter.",
            "",
            "Hard rules:",
            "- Treat the event title as the NAME of the event, never the LOCATION.",
            "- Use the venue name as the LOCATION (e.g. 'at The Cricketers'), not 'at <event name>'.",
            "- Do not put the event name in quotation marks.",
            "- Do not invent facts not present in the brief (no prizes, entertainers, ticketing info, offers, or menus unless explicitly provided).",
            "- Do not include any URLs (a booking link is handled separately).",
            "",
            "Always return valid JSON matching the requested schema."
          ].join("\n")
      },
      {
        role: "user",
        content: [
          "Create website copy for the following event.",
          "",
          "Requirements:",
          "- publicTitle: catchy guest-facing event name (<= 80 chars).",
          "- publicTeaser: short teaser for cards/social (<= 160 chars).",
          "- publicDescription: 260–340 words, 2–4 short paragraphs, booking-focused; MUST include the venue name and the UK date + time range from the brief.",
          "- seoTitle: <= 60 characters.",
          "- seoDescription: <= 155 characters.",
          "- seoSlug: lowercase words separated by hyphens; no dates unless necessary.",
          "",
          "Style rules:",
          "- Open the description with a line like: 'Join us at <VENUE NAME> for <PUBLIC TITLE>…'",
          "- Never write 'at <event name>' (the event is not the location). Use 'for <event name>' when needed.",
          "- UK English spelling and date formatting.",
          "",
          `Event brief:\n${buildWebsiteCopyPrompt(input)}`
        ].join("\n")
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "event_website_copy",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["publicTitle", "publicTeaser", "publicDescription", "seoTitle", "seoDescription", "seoSlug"],
          properties: {
            publicTitle: {
              type: "string",
              description: "Public-facing event name, catchy and guest-friendly, <= ~80 characters."
            },
            publicTeaser: {
              type: "string",
              description: "Short teaser for marketing cards/social, <= ~160 characters."
            },
            publicDescription: {
              type: "string",
              description: "Guest-facing description (~300 words), urgency-driven, no URLs."
            },
            seoTitle: {
              type: "string",
              description: "SEO meta title <= 60 characters."
            },
            seoDescription: {
              type: "string",
              description: "SEO meta description <= 155 characters."
            },
            seoSlug: {
              type: "string",
              description: "URL slug made of lowercase words separated by hyphens."
            }
          }
        }
      }
    }
  };

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("AI website copy request failed", response.status, errorBody);
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | Array<{ type: string; text?: string }> } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    const parsed = (() => {
      if (typeof content === "string") {
        return parseWebsiteCopy(content);
      }
      if (Array.isArray(content)) {
        const combined = content
          .filter((part) => part.type === "text" && typeof part.text === "string")
          .map((part) => part.text)
          .join("");
        return parseWebsiteCopy(combined);
      }
      return null;
    })();

    if (!parsed) return null;

    const cleanedPublicTitle = stripWrappingQuotes(parsed.publicTitle);
    const cleanedTeaser = stripWrappingQuotes(parsed.publicTeaser);

    const locationFixedDescription = (() => {
      let value = stripUrls(parsed.publicDescription);
      const candidates = [cleanedPublicTitle, input.title].map((v) => v.trim()).filter(Boolean);
      for (const candidate of candidates) {
        const escaped = escapeRegExp(candidate);
        value = value.replace(new RegExp(`[\"“”'‘’]\\s*${escaped}\\s*[\"“”'‘’]`, "gi"), candidate);
        const isVenueName =
          typeof input.venueName === "string" &&
          input.venueName.trim().length > 0 &&
          candidate.toLowerCase() === input.venueName.trim().toLowerCase();
        if (!isVenueName) {
          value = value.replace(new RegExp(`\\bat\\s+[\"“”'‘’]?\\s*${escaped}\\s*[\"“”'‘’]?`, "gi"), `for ${candidate}`);
        }
      }
      if (input.venueName && !value.toLowerCase().includes(input.venueName.toLowerCase())) {
        value = `Join us at ${input.venueName} for ${cleanedPublicTitle}.\n\n${value}`;
      }
      return value;
    })();

    const cleanedDescription = clampWords(locationFixedDescription, 340);
    return {
      ...parsed,
      publicTitle: clampChars(cleanedPublicTitle, 80),
      publicTeaser: clampChars(cleanedTeaser, 160),
      publicDescription: cleanedDescription,
      seoTitle: clampChars(stripWrappingQuotes(parsed.seoTitle), 60),
      seoDescription: clampChars(stripWrappingQuotes(parsed.seoDescription), 155),
      seoSlug: sanitiseSeoSlug(parsed.seoSlug)
    };
  } catch (error) {
    console.error("Unexpected error generating AI website copy", error);
  }

  return null;
}
