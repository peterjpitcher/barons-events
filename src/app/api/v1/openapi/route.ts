import "server-only";

import { NextResponse } from "next/server";

import { requireWebsiteApiKey } from "@/lib/public-api/auth";

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
          eventType: { type: "string" },
          status: { type: "string", enum: ["approved", "completed"] },
          startAt: { type: "string", format: "date-time" },
          endAt: { type: "string", format: "date-time" },
          venueSpaces: { type: "array", items: { type: "string" } },
          description: { type: ["string", "null"] },
          bookingUrl: { type: ["string", "null"], format: "uri" },
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
          "eventType",
          "status",
          "startAt",
          "endAt",
          "venueSpaces",
          "description",
          "bookingUrl",
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
        summary: "List venues (with areas)",
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
                          capacity: { type: ["integer", "null"] },
                          areas: {
                            type: "array",
                            items: {
                              type: "object",
                              additionalProperties: false,
                              properties: {
                                id: { type: "string", format: "uuid" },
                                name: { type: "string" },
                                capacity: { type: ["integer", "null"] }
                              },
                              required: ["id", "name", "capacity"]
                            }
                          }
                        },
                        required: ["id", "name", "address", "capacity", "areas"]
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
    }
  }
} as const;

export async function GET(request: Request) {
  const authResponse = requireWebsiteApiKey(request);
  if (authResponse) return authResponse;

  return NextResponse.json(spec, {
    headers: {
      "cache-control": "no-store"
    }
  });
}
