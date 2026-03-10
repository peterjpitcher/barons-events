import "server-only";

import { NextResponse } from "next/server";

import { checkApiRateLimit, requireWebsiteApiKey } from "@/lib/public-api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const spec = {
  openapi: "3.1.0",
  info: {
    title: "EventHub Website API",
    version: "1.0.0",
    description: "Server-to-server API for publishing approved EventHub events to the brand website."
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "API key"
      }
    },
    schemas: {
      ErrorResponse: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              details: {}
            },
            required: ["code", "message"]
          }
        },
        required: ["error"]
      },
      PublicVenue: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          address: { type: ["string", "null"] },
          capacity: { type: ["integer", "null"] }
        },
        required: ["id", "name", "address", "capacity"]
      },
      PublicEvent: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", format: "uuid" },
          slug: { type: "string" },
          title: { type: "string" },
          teaser: { type: ["string", "null"] },
          highlights: { type: "array", items: { type: "string" } },
          eventType: { type: "string" },
          status: { type: "string", enum: ["approved", "completed"] },
          startAt: { type: "string", format: "date-time" },
          endAt: { type: "string", format: "date-time" },
          venueSpaces: { type: "array", items: { type: "string" } },
          description: { type: ["string", "null"] },
          bookingType: { type: ["string", "null"], enum: ["ticketed", "table_booking", "free_entry", "mixed", null] },
          ticketPrice: { type: ["number", "null"] },
          checkInCutoffMinutes: { type: ["integer", "null"] },
          agePolicy: { type: ["string", "null"] },
          accessibilityNotes: { type: ["string", "null"] },
          cancellationWindowHours: { type: ["integer", "null"] },
          termsAndConditions: { type: ["string", "null"] },
          bookingUrl: { type: ["string", "null"], format: "uri" },
          eventImageUrl: { type: ["string", "null"], format: "uri" },
          seoTitle: { type: ["string", "null"] },
          seoDescription: { type: ["string", "null"] },
          seoSlug: { type: ["string", "null"] },
          wetPromo: { type: ["string", "null"] },
          foodPromo: { type: ["string", "null"] },
          venue: { $ref: "#/components/schemas/PublicVenue" },
          updatedAt: { type: "string", format: "date-time" }
        },
        required: [
          "id",
          "slug",
          "title",
          "teaser",
          "highlights",
          "eventType",
          "status",
          "startAt",
          "endAt",
          "venueSpaces",
          "description",
          "bookingType",
          "ticketPrice",
          "checkInCutoffMinutes",
          "agePolicy",
          "accessibilityNotes",
          "cancellationWindowHours",
          "termsAndConditions",
          "bookingUrl",
          "eventImageUrl",
          "seoTitle",
          "seoDescription",
          "seoSlug",
          "wetPromo",
          "foodPromo",
          "venue",
          "updatedAt"
        ]
      }
    }
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/api/v1/health": {
      get: {
        summary: "Health check (auth required)",
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { ok: { type: "boolean" } },
                  required: ["ok"]
                }
              }
            }
          },
          "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "503": { description: "Not configured", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } }
        }
      }
    },
    "/api/v1/events": {
      get: {
        summary: "List public events (approved + completed)",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
          { name: "cursor", in: "query", schema: { type: "string" }, description: "Opaque cursor from the previous response." },
          { name: "from", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "to", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "endsAfter", in: "query", schema: { type: "string", format: "date-time" }, description: "Filters events whose end time is >= this value." },
          { name: "updatedSince", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "venueId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "eventType", in: "query", schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/PublicEvent" } },
                    meta: {
                      type: "object",
                      properties: { nextCursor: { type: ["string", "null"] } },
                      required: ["nextCursor"]
                    }
                  },
                  required: ["data", "meta"]
                }
              }
            }
          },
          "400": { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "500": { description: "Internal error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "503": { description: "Not configured", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } }
        }
      }
    },
    "/api/v1/events/{eventId}": {
      get: {
        summary: "Fetch a single public event (approved + completed)",
        parameters: [{ name: "eventId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { data: { $ref: "#/components/schemas/PublicEvent" } },
                  required: ["data"]
                }
              }
            }
          },
          "400": { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "404": { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "500": { description: "Internal error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "503": { description: "Not configured", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } }
        }
      }
    },
    "/api/v1/events/by-slug/{slug}": {
      get: {
        summary: "Fetch a single public event by slug",
        parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { $ref: "#/components/schemas/PublicEvent" },
                    meta: {
                      type: "object",
                      properties: {
                        requestedSlug: { type: "string" },
                        canonicalSlug: { type: "string" },
                        isCanonical: { type: "boolean" }
                      },
                      required: ["requestedSlug", "canonicalSlug", "isCanonical"]
                    }
                  },
                  required: ["data", "meta"]
                }
              }
            }
          },
          "400": { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "404": { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "500": { description: "Internal error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "503": { description: "Not configured", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } }
        }
      }
    },
    "/api/v1/venues": {
      get: {
        summary: "List venues",
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          id: { type: "string", format: "uuid" },
                          name: { type: "string" },
                          address: { type: ["string", "null"] },
                          capacity: { type: ["integer", "null"] }
                        },
                        required: ["id", "name", "address", "capacity"]
                      }
                    }
                  },
                  required: ["data"]
                }
              }
            }
          },
          "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "500": { description: "Internal error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "503": { description: "Not configured", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } }
        }
      }
    },
    "/api/v1/event-types": {
      get: {
        summary: "List event types",
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          id: { type: "string", format: "uuid" },
                          label: { type: "string" },
                          created_at: { type: "string", format: "date-time" }
                        },
                        required: ["id", "label", "created_at"]
                      }
                    }
                  },
                  required: ["data"]
                }
              }
            }
          },
          "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "500": { description: "Internal error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "503": { description: "Not configured", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } }
        }
      }
    },
    "/api/v1/opening-times": {
      get: {
        operationId: "getOpeningTimes",
        summary: "Get resolved opening times",
        description: "Returns day-by-day effective opening times for all venues (or one venue), with date-specific overrides already applied. The consumer receives the final hours for each day and never needs to merge templates with exceptions.",
        parameters: [
          {
            name: "days",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 90, default: 7 },
            description: "Number of days to return, starting from today (Europe/London). Defaults to 7, maximum 90."
          },
          {
            name: "venueId",
            in: "query",
            required: false,
            schema: { type: "string", format: "uuid" },
            description: "Filter results to a single venue. Omit to receive all venues."
          }
        ],
        responses: {
          "200": {
            description: "Resolved opening times",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    from: { type: "string", format: "date", example: "2026-03-10" },
                    to: { type: "string", format: "date", example: "2026-03-16" },
                    venues: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          venueId: { type: "string", format: "uuid" },
                          venueName: { type: "string" },
                          days: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {
                                date: { type: "string", format: "date" },
                                dayOfWeek: {
                                  type: "string",
                                  enum: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
                                },
                                services: {
                                  type: "array",
                                  items: {
                                    type: "object",
                                    properties: {
                                      serviceTypeId: { type: "string", format: "uuid" },
                                      serviceType: { type: "string", example: "Bar" },
                                      isOpen: { type: "boolean" },
                                      openTime: { type: "string", nullable: true, example: "11:00" },
                                      closeTime: { type: "string", nullable: true, example: "23:00" },
                                      isOverride: { type: "boolean", description: "True when these hours come from a date-specific override rather than the weekly template." },
                                      note: { type: "string", nullable: true, description: "Optional note from the override record explaining the change." }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": { description: "Invalid query parameters", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "401": { description: "Missing or invalid API key", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "404": { description: "Venue not found (when venueId supplied)", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "429": { description: "Rate limit exceeded" },
          "500": { description: "Database error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "503": { description: "Supabase service role not configured", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } }
        },
        security: [{ bearerAuth: [] }]
      }
    }
  }
} as const;

export async function GET(request: Request) {
  const rateLimitResponse = checkApiRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  const authResponse = requireWebsiteApiKey(request);
  if (authResponse) return authResponse;

  return NextResponse.json(spec, {
    headers: {
      "cache-control": "no-store"
    }
  });
}
