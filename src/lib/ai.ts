import "server-only";

import type { EventDetail } from "@/lib/events";

export type GeneratedEventMeta = {
  metaTitle: string;
  metaDescription: string;
  slug: string;
  teaser: string;
};

function buildPrompt(event: EventDetail): string {
  const lines = [
    `Title: ${event.title}`,
    `Status: ${event.status}`,
    `Venue: ${event.venue?.name ?? "Unknown venue"}`,
    `Space: ${event.venue_space}`,
    `Type: ${event.event_type}`,
    `Start: ${new Date(event.start_at).toISOString()}`,
    `End: ${new Date(event.end_at).toISOString()}`,
    `Expected headcount: ${event.expected_headcount ?? "Not provided"}`,
    `Wet promotion: ${event.wet_promo ?? "None"}`,
    `Food promotion: ${event.food_promo ?? "None"}`,
    `Goals: ${event.goal_focus ?? "None listed"}`,
    `Notes: ${event.notes ?? "No additional notes"}`
  ];
  return lines.join("\n");
}

function parseContent(content: unknown): GeneratedEventMeta | null {
  if (typeof content !== "string") return null;
  try {
    const data = JSON.parse(content);
    if (
      typeof data.metaTitle === "string" &&
      typeof data.metaDescription === "string" &&
      typeof data.slug === "string" &&
      typeof data.teaser === "string"
    ) {
      return {
        metaTitle: data.metaTitle.trim(),
        metaDescription: data.metaDescription.trim(),
        slug: data.slug.trim(),
        teaser: data.teaser.trim()
      };
    }
  } catch (error) {
    console.error("Failed to parse AI metadata response", error);
  }
  return null;
}

export async function generateEventMeta(event: EventDetail): Promise<GeneratedEventMeta | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("OPENAI_API_KEY is not set. Skipping AI metadata generation.");
    return null;
  }

  const body = {
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are a marketing copy assistant helping a hospitality brand promote events. Produce concise, high-converting metadata for the event landing page. Always return valid JSON matching the requested schema."
      },
      {
        role: "user",
        content: `Create metadata for the following event:\n${buildPrompt(event)}`
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "event_metadata",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["metaTitle", "metaDescription", "slug", "teaser"],
          properties: {
            metaTitle: {
              type: "string",
              description: "SEO-friendly meta title, maximum 60 characters, highlight the unique hook."
            },
            metaDescription: {
              type: "string",
              description: "Meta description up to 150 characters inviting guests to attend."
            },
            slug: {
              type: "string",
              description: "URL slug made of lowercase words separated by hyphens (5-7 words)."
            },
            teaser: {
              type: "string",
              description: "Short teaser (max 140 characters) for marketing cards and social posts."
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
      console.error("AI metadata request failed", response.status, errorBody);
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | Array<{ type: string; text?: string }> } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      return parseContent(content);
    }
    if (Array.isArray(content)) {
      const combined = content
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("");
      return parseContent(combined);
    }
  } catch (error) {
    console.error("Unexpected error generating AI metadata", error);
  }

  return null;
}
