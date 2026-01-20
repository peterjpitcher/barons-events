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

function buildWebsiteCopyPrompt(input: WebsiteCopyInput): string {
  const lines = [
    `Title: ${input.title}`,
    `Venue: ${input.venueName ?? "Unknown venue"}`,
    input.venueAddress ? `Venue address: ${input.venueAddress}` : `Venue address: Not provided`,
    input.venueSpaces.length ? `Spaces: ${input.venueSpaces.join(", ")}` : "Spaces: Not specified",
    `Type: ${input.eventType}`,
    `Start: ${new Date(input.startAt).toISOString()}`,
    `End: ${new Date(input.endAt).toISOString()}`,
    `Expected headcount: ${input.expectedHeadcount ?? "Not provided"}`,
    `Wet promotion: ${input.wetPromo ?? "None"}`,
    `Food promotion: ${input.foodPromo ?? "None"}`,
    `Details: ${input.details ?? "Not provided"}`
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
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are a hospitality marketing copywriter. Write guest-facing event copy that is accurate, high-converting, and urgency-driven without being misleading. Do not invent details not present in the brief. Do not include any URLs. Always return valid JSON matching the requested schema."
      },
      {
        role: "user",
        content: [
          "Create website copy for the following event.",
          "",
          "Requirements:",
          "- publicTitle: catchy public-facing event name (max ~80 chars).",
          "- publicTeaser: short teaser for cards/social (max ~160 chars).",
          "- publicDescription: ~300 words (aim 260–340), exciting and booking-focused; include date/time and venue; mention wet/food promos if present; drive urgency to secure a spot.",
          "- seoTitle: SEO title <= 60 characters.",
          "- seoDescription: SEO description <= 155 characters.",
          "- seoSlug: lowercase words separated by hyphens; no dates unless necessary.",
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

    const cleanedDescription = clampWords(stripUrls(parsed.publicDescription), 340);
    return {
      ...parsed,
      publicDescription: cleanedDescription,
      seoSlug: sanitiseSeoSlug(parsed.seoSlug)
    };
  } catch (error) {
    console.error("Unexpected error generating AI website copy", error);
  }

  return null;
}
