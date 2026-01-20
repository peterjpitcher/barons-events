export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          role: string;
          venue_id: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      venues: {
        Row: {
          id: string;
          name: string;
          address: string | null;
          capacity: number | null;
          default_reviewer_id: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      venue_areas: {
        Row: {
          id: string;
          venue_id: string;
          name: string;
          capacity: number | null;
          created_at: string;
          updated_at: string;
        };
      };
      event_types: {
        Row: {
          id: string;
          label: string;
          created_at: string;
        };
      };
      events: {
        Row: {
          id: string;
          venue_id: string;
          status: string;
          title: string;
          event_type: string;
          start_at: string;
          end_at: string;
          venue_space: string;
          expected_headcount: number | null;
          wet_promo: string | null;
          food_promo: string | null;
          goal_focus: string | null;
          notes: string | null;
          public_title: string | null;
          public_description: string | null;
          public_teaser: string | null;
          booking_url: string | null;
          seo_title: string | null;
          seo_description: string | null;
          seo_slug: string | null;
          created_by: string;
          assignee_id: string | null;
          submitted_at: string | null;
          cost_total: number | null;
          cost_details: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      event_versions: {
        Row: {
          id: string;
          event_id: string;
          version: number;
          payload: Json;
          submitted_at: string | null;
          submitted_by: string | null;
        };
      };
      approvals: {
        Row: {
          id: string;
          event_id: string;
          decision: string;
          reviewer_id: string;
          feedback_text: string | null;
          decided_at: string;
        };
      };
      debriefs: {
        Row: {
          id: string;
          event_id: string;
          attendance: number | null;
          wet_takings: number | null;
          food_takings: number | null;
          promo_effectiveness: number | null;
          highlights: string | null;
          issues: string | null;
          submitted_by: string;
          submitted_at: string;
        };
      };
      audit_log: {
        Row: {
          id: string;
          entity: string;
          entity_id: string;
          action: string;
          meta: Json | null;
          actor_id: string | null;
          created_at: string;
        };
      };
    };
  };
}
