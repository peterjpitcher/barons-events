type AiGenerationArgs = {
  eventTitle: string;
  venueName: string | null;
  reason?: string | null;
};

export type AiGenerationResult = {
  synopsis: string;
  heroCopy: string;
  seoKeywords: string[];
  audienceTags: string[];
  talentBios: string[];
  generatedBy: string;
};

const fallbackGeneration = ({ eventTitle, venueName, reason }: AiGenerationArgs): AiGenerationResult => {
  const baseVenue = venueName ? ` at ${venueName}` : "";
  const rationale = reason ? ` (Requested because: ${reason})` : "";
  return {
    synopsis: `${eventTitle}${baseVenue} – refreshed copy${rationale}.`,
    heroCopy: `Experience ${eventTitle}${baseVenue}. Reserve your spot today!`,
    seoKeywords: ["events", "barons", eventTitle.toLowerCase()],
    audienceTags: ["general", "hq"],
    talentBios: [],
    generatedBy: "fallback",
  };
};

const normaliseStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string") {
          return entry.trim();
        }
        if (
          entry &&
          typeof entry === "object" &&
          "text" in (entry as Record<string, unknown>)
        ) {
          const text = (entry as { text?: unknown }).text;
          return typeof text === "string" ? text.trim() : "";
        }
        return "";
      })
      .filter((entry) => entry.length > 0);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return [];
};

const parseAiOutput = (raw: unknown): AiGenerationResult => {
  if (!raw || typeof raw !== "object") {
    throw new Error("AI response payload missing");
  }

  const payload = raw as Record<string, unknown>;
  const synopsis = typeof payload.synopsis === "string" ? payload.synopsis.trim() : "";
  const heroCopy = typeof payload.heroCopy === "string" ? payload.heroCopy.trim() : "";

  if (!synopsis || !heroCopy) {
    throw new Error("AI response missing synopsis or hero copy");
  }

  return {
    synopsis,
    heroCopy,
    seoKeywords: normaliseStringArray(payload.seoKeywords),
    audienceTags: normaliseStringArray(payload.audienceTags),
    talentBios: normaliseStringArray(payload.talentBios),
    generatedBy: "openai-gpt-4o-mini",
  };
};

export async function generateAiMetadata(args: AiGenerationArgs): Promise<AiGenerationResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return fallbackGeneration(args);
  }

  const model = process.env.OPENAI_METADATA_MODEL?.trim() || "gpt-4o-mini";

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: [
              {
                type: "text",
                text: [
                  "You craft structured marketing metadata for EventHub by Barons.",
                  "Respond in British English and keep tone premium yet approachable.",
                  "Stay concise; synopsis must be <= 240 characters.",
                ].join(" "),
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: [
                  `Event title: ${args.eventTitle}`,
                  args.venueName ? `Venue: ${args.venueName}` : null,
                  args.reason ? `Planner notes: ${args.reason}` : null,
                  "Return JSON describing synopsis, hero copy, SEO keywords, audience tags, and optional talent bios.",
                ]
                  .filter(Boolean)
                  .join("\n"),
              },
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "barons_event_metadata",
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["synopsis", "heroCopy"],
              properties: {
                synopsis: {
                  type: "string",
                  maxLength: 240,
                  description: "Short summary suitable for planners and executive digests.",
                },
                heroCopy: {
                  type: "string",
                  description: "A punchy marketing line used for promotional banners.",
                },
                seoKeywords: {
                  type: "array",
                  items: { type: "string" },
                  maxItems: 5,
                  description: "Lowercase SEO-friendly keywords.",
                },
                audienceTags: {
                  type: "array",
                  items: { type: "string" },
                  maxItems: 5,
                  description: "Segments or audiences most relevant to this event.",
                },
                talentBios: {
                  type: "array",
                  items: { type: "string" },
                  maxItems: 5,
                  description: "Optional list of talent names or short bios.",
                },
              },
            },
            strict: true,
          },
        },
        max_output_tokens: 600,
        temperature: 0.6,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI responded with ${response.status}`);
    }

    const json = await response.json();
    const rawPayload =
      json.output?.[0]?.content?.find(
        (entry: Record<string, unknown>) => entry?.type === "output_text"
      )?.text ?? json.output_text ?? "";

    const parsedJson =
      typeof rawPayload === "string" && rawPayload.trim().length > 0 ? JSON.parse(rawPayload) : rawPayload;

    return parseAiOutput(parsedJson);
  } catch (error) {
    console.error(
      "[ai] Falling back to template generation",
      error instanceof Error ? error.message : error
    );
    return fallbackGeneration(args);
  }
}
