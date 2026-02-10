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
      artists: {
        Row: {
          id: string;
          name: string;
          email: string | null;
          phone: string | null;
          artist_type: string;
          description: string | null;
          is_curated: boolean;
          is_archived: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      event_artists: {
        Row: {
          id: string;
          event_id: string;
          artist_id: string;
          billing_order: number;
          role_label: string | null;
          created_by: string | null;
          created_at: string;
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
          event_image_path: string | null;
          booking_type: string | null;
          ticket_price: number | null;
          check_in_cutoff_minutes: number | null;
          age_policy: string | null;
          accessibility_notes: string | null;
          cancellation_window_hours: number | null;
          terms_and_conditions: string | null;
          public_title: string | null;
          public_description: string | null;
          public_teaser: string | null;
          public_highlights: string[] | null;
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
          baseline_attendance: number | null;
          baseline_wet_takings: number | null;
          baseline_food_takings: number | null;
          actual_total_takings: number | null;
          baseline_total_takings: number | null;
          sales_uplift_value: number | null;
          sales_uplift_percent: number | null;
          promo_effectiveness: number | null;
          highlights: string | null;
          issues: string | null;
          guest_sentiment_notes: string | null;
          operational_notes: string | null;
          would_book_again: boolean | null;
          next_time_actions: string | null;
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
