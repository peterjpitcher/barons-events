export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_content: {
        Row: {
          audience_tags: Json | null
          created_at: string
          event_id: string
          generated_at: string
          generated_by: string | null
          hero_copy: string | null
          id: string
          published_at: string | null
          reviewed_by: string | null
          seo_keywords: Json | null
          synopsis: string | null
          talent_bios: Json | null
          version: number
        }
        Insert: {
          audience_tags?: Json | null
          created_at?: string
          event_id: string
          generated_at?: string
          generated_by?: string | null
          hero_copy?: string | null
          id?: string
          published_at?: string | null
          reviewed_by?: string | null
          seo_keywords?: Json | null
          synopsis?: string | null
          talent_bios?: Json | null
          version: number
        }
        Update: {
          audience_tags?: Json | null
          created_at?: string
          event_id?: string
          generated_at?: string
          generated_by?: string | null
          hero_copy?: string | null
          id?: string
          published_at?: string | null
          reviewed_by?: string | null
          seo_keywords?: Json | null
          synopsis?: string | null
          talent_bios?: Json | null
          version?: number
        }
        Relationships: []
      }
      ai_publish_queue: {
        Row: {
          content_id: string
          created_at: string
          dispatched_at: string | null
          event_id: string
          id: string
          payload: Json
          status: string
          updated_at: string
        }
        Insert: {
          content_id: string
          created_at?: string
          dispatched_at?: string | null
          event_id: string
          id?: string
          payload: Json
          status?: string
          updated_at?: string
        }
        Update: {
          content_id?: string
          created_at?: string
          dispatched_at?: string | null
          event_id?: string
          id?: string
          payload?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_publish_queue_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "ai_content"
            referencedColumns: ["id"]
          },
        ]
      }
      app_sessions: {
        Row: {
          created_at: string
          expires_at: string | null
          ip_address: string | null
          last_activity_at: string
          previous_session_token_hash: string | null
          session_id: string
          session_token_hash: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          ip_address?: string | null
          last_activity_at?: string
          previous_session_token_hash?: string | null
          session_id?: string
          session_token_hash?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          ip_address?: string | null
          last_activity_at?: string
          previous_session_token_hash?: string | null
          session_id?: string
          session_token_hash?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      approvals: {
        Row: {
          decided_at: string
          decision: string
          event_id: string
          feedback_text: string | null
          id: string
          reviewer_id: string | null
        }
        Insert: {
          decided_at?: string
          decision: string
          event_id: string
          feedback_text?: string | null
          id?: string
          reviewer_id?: string | null
        }
        Update: {
          decided_at?: string
          decision?: string
          event_id?: string
          feedback_text?: string | null
          id?: string
          reviewer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approvals_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      artists: {
        Row: {
          artist_type: string
          created_at: string
          created_by: string | null
          description: string | null
          email: string | null
          id: string
          is_archived: boolean
          is_curated: boolean
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          artist_type?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          email?: string | null
          id?: string
          is_archived?: boolean
          is_curated?: boolean
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          artist_type?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          email?: string | null
          id?: string
          is_archived?: boolean
          is_curated?: boolean
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "artists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      attachment_versions: {
        Row: {
          attachment_id: string
          created_at: string
          id: string
          mime_type: string
          original_filename: string
          size_bytes: number
          storage_path: string
          uploaded_by: string | null
          version_no: number
        }
        Insert: {
          attachment_id: string
          created_at?: string
          id?: string
          mime_type: string
          original_filename: string
          size_bytes: number
          storage_path: string
          uploaded_by?: string | null
          version_no: number
        }
        Update: {
          attachment_id?: string
          created_at?: string
          id?: string
          mime_type?: string
          original_filename?: string
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string | null
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "attachment_versions_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachment_versions_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          created_at: string
          current_version_id: string | null
          deleted_at: string | null
          display_name: string | null
          event_id: string | null
          id: string
          mime_type: string
          original_filename: string
          planning_item_id: string | null
          planning_task_id: string | null
          size_bytes: number
          storage_path: string
          upload_status: string
          uploaded_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          current_version_id?: string | null
          deleted_at?: string | null
          display_name?: string | null
          event_id?: string | null
          id?: string
          mime_type: string
          original_filename: string
          planning_item_id?: string | null
          planning_task_id?: string | null
          size_bytes: number
          storage_path: string
          upload_status?: string
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          current_version_id?: string | null
          deleted_at?: string | null
          display_name?: string | null
          event_id?: string | null
          id?: string
          mime_type?: string
          original_filename?: string
          planning_item_id?: string | null
          planning_task_id?: string | null
          size_bytes?: number
          storage_path?: string
          upload_status?: string
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_current_version_id_fkey"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "attachment_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_planning_item_id_fkey"
            columns: ["planning_item_id"]
            isOneToOne: false
            referencedRelation: "planning_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_planning_task_id_fkey"
            columns: ["planning_task_id"]
            isOneToOne: false
            referencedRelation: "planning_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity: string
          entity_id: string
          id: string
          meta: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity: string
          entity_id: string
          id?: string
          meta?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity?: string
          entity_id?: string
          id?: string
          meta?: Json | null
        }
        Relationships: []
      }
      booking_transfers: {
        Row: {
          admin_user_id: string | null
          amount_pence: number
          created_at: string
          from_booking_id: string | null
          from_event_id: string | null
          from_event_start_at: string | null
          from_event_title: string
          id: string
          idempotency_key: string
          manual_contact_required: boolean
          reason: string | null
          ticket_count: number
          to_booking_id: string | null
          to_event_id: string | null
          to_event_start_at: string | null
          to_event_title: string
          transaction_id: string | null
          transfer_email_failed_at: string | null
          transfer_email_sent_at: string | null
        }
        Insert: {
          admin_user_id?: string | null
          amount_pence: number
          created_at?: string
          from_booking_id?: string | null
          from_event_id?: string | null
          from_event_start_at?: string | null
          from_event_title: string
          id?: string
          idempotency_key: string
          manual_contact_required?: boolean
          reason?: string | null
          ticket_count: number
          to_booking_id?: string | null
          to_event_id?: string | null
          to_event_start_at?: string | null
          to_event_title: string
          transaction_id?: string | null
          transfer_email_failed_at?: string | null
          transfer_email_sent_at?: string | null
        }
        Update: {
          admin_user_id?: string | null
          amount_pence?: number
          created_at?: string
          from_booking_id?: string | null
          from_event_id?: string | null
          from_event_start_at?: string | null
          from_event_title?: string
          id?: string
          idempotency_key?: string
          manual_contact_required?: boolean
          reason?: string | null
          ticket_count?: number
          to_booking_id?: string | null
          to_event_id?: string | null
          to_event_start_at?: string | null
          to_event_title?: string
          transaction_id?: string | null
          transfer_email_failed_at?: string | null
          transfer_email_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_transfers_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_transfers_from_booking_id_fkey"
            columns: ["from_booking_id"]
            isOneToOne: false
            referencedRelation: "event_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_transfers_from_event_id_fkey"
            columns: ["from_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_transfers_to_booking_id_fkey"
            columns: ["to_booking_id"]
            isOneToOne: false
            referencedRelation: "event_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_transfers_to_event_id_fkey"
            columns: ["to_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_transfers_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      business_settings: {
        Row: {
          accountant_sales_report_email: string
          accountant_sales_report_enabled: boolean
          id: boolean
          labour_rate_gbp: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          accountant_sales_report_email?: string
          accountant_sales_report_enabled?: boolean
          id?: boolean
          labour_rate_gbp?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          accountant_sales_report_email?: string
          accountant_sales_report_enabled?: boolean
          id?: boolean
          labour_rate_gbp?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_alert_logs: {
        Row: {
          created_at: string
          detail: string | null
          id: string
          job: string
          message: string
          response_body: string | null
          response_status: number | null
          severity: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          id?: string
          job: string
          message: string
          response_body?: string | null
          response_status?: number | null
          severity?: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          id?: string
          job?: string
          message?: string
          response_body?: string | null
          response_status?: number | null
          severity?: string
        }
        Relationships: []
      }
      customer_consent_events: {
        Row: {
          booking_id: string | null
          consent_wording: string
          created_at: string | null
          customer_id: string
          event_type: string
          id: string
        }
        Insert: {
          booking_id?: string | null
          consent_wording: string
          created_at?: string | null
          customer_id: string
          event_type: string
          id?: string
        }
        Update: {
          booking_id?: string | null
          consent_wording?: string
          created_at?: string | null
          customer_id?: string
          event_type?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_consent_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "event_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_consent_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string | null
          email: string | null
          first_name: string
          id: string
          last_name: string | null
          marketing_opt_in: boolean
          mobile: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          first_name: string
          id?: string
          last_name?: string | null
          marketing_opt_in?: boolean
          mobile: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          first_name?: string
          id?: string
          last_name?: string | null
          marketing_opt_in?: boolean
          mobile?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      debriefs: {
        Row: {
          actual_total_takings: number | null
          attendance: number | null
          baseline_attendance: number | null
          baseline_food_takings: number | null
          baseline_total_takings: number | null
          baseline_wet_takings: number | null
          event_id: string
          food_takings: number | null
          guest_sentiment_notes: string | null
          highlights: string | null
          id: string
          issues: string | null
          labour_hours: number | null
          labour_rate_gbp_at_submit: number | null
          next_time_actions: string | null
          operational_notes: string | null
          promo_effectiveness: number | null
          sales_uplift_percent: number | null
          sales_uplift_value: number | null
          submitted_at: string
          submitted_by: string
          wet_takings: number | null
          would_book_again: boolean | null
        }
        Insert: {
          actual_total_takings?: number | null
          attendance?: number | null
          baseline_attendance?: number | null
          baseline_food_takings?: number | null
          baseline_total_takings?: number | null
          baseline_wet_takings?: number | null
          event_id: string
          food_takings?: number | null
          guest_sentiment_notes?: string | null
          highlights?: string | null
          id?: string
          issues?: string | null
          labour_hours?: number | null
          labour_rate_gbp_at_submit?: number | null
          next_time_actions?: string | null
          operational_notes?: string | null
          promo_effectiveness?: number | null
          sales_uplift_percent?: number | null
          sales_uplift_value?: number | null
          submitted_at?: string
          submitted_by: string
          wet_takings?: number | null
          would_book_again?: boolean | null
        }
        Update: {
          actual_total_takings?: number | null
          attendance?: number | null
          baseline_attendance?: number | null
          baseline_food_takings?: number | null
          baseline_total_takings?: number | null
          baseline_wet_takings?: number | null
          event_id?: string
          food_takings?: number | null
          guest_sentiment_notes?: string | null
          highlights?: string | null
          id?: string
          issues?: string | null
          labour_hours?: number | null
          labour_rate_gbp_at_submit?: number | null
          next_time_actions?: string | null
          operational_notes?: string | null
          promo_effectiveness?: number | null
          sales_uplift_percent?: number | null
          sales_uplift_value?: number | null
          submitted_at?: string
          submitted_by?: string
          wet_takings?: number | null
          would_book_again?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "debriefs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debriefs_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      event_artists: {
        Row: {
          artist_id: string
          billing_order: number
          created_at: string
          created_by: string | null
          event_id: string
          id: string
          role_label: string | null
        }
        Insert: {
          artist_id: string
          billing_order?: number
          created_at?: string
          created_by?: string | null
          event_id: string
          id?: string
          role_label?: string | null
        }
        Update: {
          artist_id?: string
          billing_order?: number
          created_at?: string
          created_by?: string | null
          event_id?: string
          id?: string
          role_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_artists_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_artists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_artists_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_bookings: {
        Row: {
          created_at: string
          customer_id: string | null
          customer_notes: string | null
          email: string | null
          event_id: string
          first_name: string
          id: string
          last_name: string | null
          mobile: string
          payment_completed_at: string | null
          payment_failed_at: string | null
          payment_refunded_at: string | null
          payment_status: string
          payment_transaction_id: string | null
          sms_confirmation_sent_at: string | null
          sms_post_event_sent_at: string | null
          sms_reminder_sent_at: string | null
          status: string
          ticket_count: number
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          customer_notes?: string | null
          email?: string | null
          event_id: string
          first_name: string
          id?: string
          last_name?: string | null
          mobile: string
          payment_completed_at?: string | null
          payment_failed_at?: string | null
          payment_refunded_at?: string | null
          payment_status?: string
          payment_transaction_id?: string | null
          sms_confirmation_sent_at?: string | null
          sms_post_event_sent_at?: string | null
          sms_reminder_sent_at?: string | null
          status?: string
          ticket_count: number
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          customer_notes?: string | null
          email?: string | null
          event_id?: string
          first_name?: string
          id?: string
          last_name?: string | null
          mobile?: string
          payment_completed_at?: string | null
          payment_failed_at?: string | null
          payment_refunded_at?: string | null
          payment_status?: string
          payment_transaction_id?: string | null
          sms_confirmation_sent_at?: string | null
          sms_post_event_sent_at?: string | null
          sms_reminder_sent_at?: string | null
          status?: string
          ticket_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_bookings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_bookings_payment_transaction_id_fkey"
            columns: ["payment_transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      event_creation_batches: {
        Row: {
          batch_payload: Json
          created_at: string
          created_by: string
          id: string
          idempotency_key: string
          result: Json | null
        }
        Insert: {
          batch_payload: Json
          created_at?: string
          created_by: string
          id?: string
          idempotency_key: string
          result?: Json | null
        }
        Update: {
          batch_payload?: Json
          created_at?: string
          created_by?: string
          id?: string
          idempotency_key?: string
          result?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "event_creation_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      event_save_idempotency: {
        Row: {
          created_at: string
          event_id: string | null
          idempotency_key: string
          proposal_email_sent_at: string | null
          response: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          idempotency_key: string
          proposal_email_sent_at?: string | null
          response: Json
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string | null
          idempotency_key?: string
          proposal_email_sent_at?: string | null
          response?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_save_idempotency_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_save_idempotency_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      event_types: {
        Row: {
          created_at: string
          id: string
          label: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
        }
        Relationships: []
      }
      event_venues: {
        Row: {
          created_at: string
          event_id: string
          is_primary: boolean
          venue_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          is_primary?: boolean
          venue_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          is_primary?: boolean
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_venues_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_venues_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      event_versions: {
        Row: {
          created_at: string
          event_id: string
          id: string
          payload: Json
          submitted_at: string | null
          submitted_by: string | null
          version: number
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          payload: Json
          submitted_at?: string | null
          submitted_by?: string | null
          version: number
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          payload?: Json
          submitted_at?: string | null
          submitted_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_versions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_versions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          accessibility_notes: string | null
          age_policy: string | null
          assignee_id: string | null
          booking_enabled: boolean
          booking_notes_enabled: boolean
          booking_type: string | null
          booking_url: string | null
          cancellation_window_hours: number | null
          check_in_cutoff_minutes: number | null
          cost_details: string | null
          cost_total: number | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          end_at: string | null
          event_image_path: string | null
          event_type: string | null
          expected_headcount: number | null
          food_promo: string | null
          goal_focus: string | null
          id: string
          manager_responsible_id: string | null
          max_tickets_per_booking: number
          notes: string | null
          pending_image_attach: string | null
          public_description: string | null
          public_highlights: string[] | null
          public_teaser: string | null
          public_title: string | null
          seo_description: string | null
          seo_slug: string | null
          seo_title: string | null
          sms_promo_enabled: boolean
          start_at: string
          status: string
          submitted_at: string | null
          terms_and_conditions: string | null
          ticket_price: number | null
          title: string
          total_capacity: number | null
          updated_at: string
          venue_id: string
          venue_space: string | null
          wet_promo: string | null
        }
        Insert: {
          accessibility_notes?: string | null
          age_policy?: string | null
          assignee_id?: string | null
          booking_enabled?: boolean
          booking_notes_enabled?: boolean
          booking_type?: string | null
          booking_url?: string | null
          cancellation_window_hours?: number | null
          check_in_cutoff_minutes?: number | null
          cost_details?: string | null
          cost_total?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          end_at?: string | null
          event_image_path?: string | null
          event_type?: string | null
          expected_headcount?: number | null
          food_promo?: string | null
          goal_focus?: string | null
          id?: string
          manager_responsible_id?: string | null
          max_tickets_per_booking?: number
          notes?: string | null
          pending_image_attach?: string | null
          public_description?: string | null
          public_highlights?: string[] | null
          public_teaser?: string | null
          public_title?: string | null
          seo_description?: string | null
          seo_slug?: string | null
          seo_title?: string | null
          sms_promo_enabled?: boolean
          start_at: string
          status: string
          submitted_at?: string | null
          terms_and_conditions?: string | null
          ticket_price?: number | null
          title: string
          total_capacity?: number | null
          updated_at?: string
          venue_id: string
          venue_space?: string | null
          wet_promo?: string | null
        }
        Update: {
          accessibility_notes?: string | null
          age_policy?: string | null
          assignee_id?: string | null
          booking_enabled?: boolean
          booking_notes_enabled?: boolean
          booking_type?: string | null
          booking_url?: string | null
          cancellation_window_hours?: number | null
          check_in_cutoff_minutes?: number | null
          cost_details?: string | null
          cost_total?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          end_at?: string | null
          event_image_path?: string | null
          event_type?: string | null
          expected_headcount?: number | null
          food_promo?: string | null
          goal_focus?: string | null
          id?: string
          manager_responsible_id?: string | null
          max_tickets_per_booking?: number
          notes?: string | null
          pending_image_attach?: string | null
          public_description?: string | null
          public_highlights?: string[] | null
          public_teaser?: string | null
          public_title?: string | null
          seo_description?: string | null
          seo_slug?: string | null
          seo_title?: string | null
          sms_promo_enabled?: boolean
          start_at?: string
          status?: string
          submitted_at?: string | null
          terms_and_conditions?: string | null
          ticket_price?: number | null
          title?: string
          total_capacity?: number | null
          updated_at?: string
          venue_id?: string
          venue_space?: string | null
          wet_promo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_manager_responsible_id_fkey"
            columns: ["manager_responsible_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_templates: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      goals: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          label: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          label: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          label?: string
          updated_at?: string
        }
        Relationships: []
      }
      internal_notes: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          parent_id: string
          parent_type: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          parent_id: string
          parent_type: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          parent_id?: string
          parent_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      login_attempts: {
        Row: {
          attempted_at: string
          email_hash: string
          id: string
          ip_address: string
        }
        Insert: {
          attempted_at?: string
          email_hash: string
          id?: string
          ip_address: string
        }
        Update: {
          attempted_at?: string
          email_hash?: string
          id?: string
          ip_address?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          payload: Json | null
          sent_at: string | null
          status: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          payload?: Json | null
          sent_at?: string | null
          status?: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json | null
          sent_at?: string | null
          status?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      payment_refunds: {
        Row: {
          admin_user_id: string | null
          amount_pence: number
          booking_id: string
          created_at: string
          event_id: string
          id: string
          idempotency_key: string
          reason: string | null
          status: string
          stripe_refund_id: string
          transaction_id: string
        }
        Insert: {
          admin_user_id?: string | null
          amount_pence: number
          booking_id: string
          created_at?: string
          event_id: string
          id?: string
          idempotency_key: string
          reason?: string | null
          status?: string
          stripe_refund_id: string
          transaction_id: string
        }
        Update: {
          admin_user_id?: string | null
          amount_pence?: number
          booking_id?: string
          created_at?: string
          event_id?: string
          id?: string
          idempotency_key?: string
          reason?: string | null
          status?: string
          stripe_refund_id?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_refunds_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_refunds_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "event_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_refunds_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_refunds_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          amount_pence: number
          booking_id: string
          completed_at: string | null
          created_at: string
          currency: string
          event_id: string
          failed_at: string | null
          id: string
          idempotency_key: string
          metadata: Json
          refunded_amount_pence: number
          refunded_at: string | null
          status: string
          stripe_checkout_session_id: string
          stripe_customer_id: string | null
          stripe_payment_intent_id: string | null
          updated_at: string
        }
        Insert: {
          amount_pence: number
          booking_id: string
          completed_at?: string | null
          created_at?: string
          currency?: string
          event_id: string
          failed_at?: string | null
          id?: string
          idempotency_key: string
          metadata?: Json
          refunded_amount_pence?: number
          refunded_at?: string | null
          status?: string
          stripe_checkout_session_id: string
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_pence?: number
          booking_id?: string
          completed_at?: string | null
          created_at?: string
          currency?: string
          event_id?: string
          failed_at?: string | null
          id?: string
          idempotency_key?: string
          metadata?: Json
          refunded_amount_pence?: number
          refunded_at?: string | null
          status?: string
          stripe_checkout_session_id?: string
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "event_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_webhooks: {
        Row: {
          attempts: number
          error_message: string | null
          event_type: string
          id: string
          payload_summary: Json
          processed_at: string | null
          received_at: string
          status: string
          stripe_event_id: string
        }
        Insert: {
          attempts?: number
          error_message?: string | null
          event_type: string
          id?: string
          payload_summary?: Json
          processed_at?: string | null
          received_at?: string
          status?: string
          stripe_event_id: string
        }
        Update: {
          attempts?: number
          error_message?: string | null
          event_type?: string
          id?: string
          payload_summary?: Json
          processed_at?: string | null
          received_at?: string
          status?: string
          stripe_event_id?: string
        }
        Relationships: []
      }
      pending_cascade_backfill: {
        Row: {
          attempt_count: number
          error: string | null
          id: string
          is_dead_letter: boolean
          last_attempt_at: string | null
          locked_at: string | null
          locked_by: string | null
          next_attempt_at: string | null
          processed_at: string | null
          queued_at: string
          venue_id: string
        }
        Insert: {
          attempt_count?: number
          error?: string | null
          id?: string
          is_dead_letter?: boolean
          last_attempt_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          next_attempt_at?: string | null
          processed_at?: string | null
          queued_at?: string
          venue_id: string
        }
        Update: {
          attempt_count?: number
          error?: string | null
          id?: string
          is_dead_letter?: boolean
          last_attempt_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          next_attempt_at?: string | null
          processed_at?: string | null
          queued_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_cascade_backfill_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      planning_inspiration_dismissals: {
        Row: {
          dismissed_at: string
          dismissed_by: string
          id: string
          inspiration_item_id: string
          reason: string
        }
        Insert: {
          dismissed_at?: string
          dismissed_by: string
          id?: string
          inspiration_item_id: string
          reason: string
        }
        Update: {
          dismissed_at?: string
          dismissed_by?: string
          id?: string
          inspiration_item_id?: string
          reason?: string
        }
        Relationships: []
      }
      planning_inspiration_items: {
        Row: {
          category: string
          created_at: string
          description: string | null
          event_date: string
          event_name: string
          generated_at: string
          id: string
          source: string
        }
        Insert: {
          category: string
          created_at?: string
          description?: string | null
          event_date: string
          event_name: string
          generated_at: string
          id?: string
          source: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          event_date?: string
          event_name?: string
          generated_at?: string
          id?: string
          source?: string
        }
        Relationships: []
      }
      planning_item_venues: {
        Row: {
          created_at: string
          is_primary: boolean
          planning_item_id: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          is_primary?: boolean
          planning_item_id: string
          venue_id: string
        }
        Update: {
          created_at?: string
          is_primary?: boolean
          planning_item_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "planning_item_venues_planning_item_id_fkey"
            columns: ["planning_item_id"]
            isOneToOne: false
            referencedRelation: "planning_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_item_venues_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      planning_items: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          end_at: string | null
          event_id: string | null
          id: string
          is_exception: boolean
          occurrence_on: string | null
          owner_id: string | null
          series_id: string | null
          start_at: string | null
          status: string
          target_date: string
          title: string
          type_label: string
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_at?: string | null
          event_id?: string | null
          id?: string
          is_exception?: boolean
          occurrence_on?: string | null
          owner_id?: string | null
          series_id?: string | null
          start_at?: string | null
          status: string
          target_date: string
          title: string
          type_label: string
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_at?: string | null
          event_id?: string | null
          id?: string
          is_exception?: boolean
          occurrence_on?: string | null
          owner_id?: string | null
          series_id?: string | null
          start_at?: string | null
          status?: string
          target_date?: string
          title?: string
          type_label?: string
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "planning_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_items_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_items_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_items_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "planning_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_items_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      planning_series: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          ends_on: string | null
          generated_through: string | null
          id: string
          is_active: boolean
          owner_id: string | null
          recurrence_frequency: string
          recurrence_interval: number
          recurrence_monthday: number | null
          recurrence_weekdays: number[] | null
          sop_not_required_template_ids: string[]
          starts_on: string
          title: string
          type_label: string
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_on?: string | null
          generated_through?: string | null
          id?: string
          is_active?: boolean
          owner_id?: string | null
          recurrence_frequency: string
          recurrence_interval?: number
          recurrence_monthday?: number | null
          recurrence_weekdays?: number[] | null
          sop_not_required_template_ids?: string[]
          starts_on: string
          title: string
          type_label: string
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_on?: string | null
          generated_through?: string | null
          id?: string
          is_active?: boolean
          owner_id?: string | null
          recurrence_frequency?: string
          recurrence_interval?: number
          recurrence_monthday?: number | null
          recurrence_weekdays?: number[] | null
          sop_not_required_template_ids?: string[]
          starts_on?: string
          title?: string
          type_label?: string
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "planning_series_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_series_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_series_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      planning_series_task_templates: {
        Row: {
          created_at: string
          default_assignee_id: string | null
          due_offset_days: number
          id: string
          series_id: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_assignee_id?: string | null
          due_offset_days?: number
          id?: string
          series_id: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_assignee_id?: string | null
          due_offset_days?: number
          id?: string
          series_id?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "planning_series_task_templates_default_assignee_id_fkey"
            columns: ["default_assignee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_series_task_templates_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "planning_series"
            referencedColumns: ["id"]
          },
        ]
      }
      planning_task_assignees: {
        Row: {
          created_at: string
          id: string
          task_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          task_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          task_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "planning_task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "planning_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_task_assignees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      planning_task_dependencies: {
        Row: {
          created_at: string
          depends_on_task_id: string
          id: string
          task_id: string
        }
        Insert: {
          created_at?: string
          depends_on_task_id: string
          id?: string
          task_id: string
        }
        Update: {
          created_at?: string
          depends_on_task_id?: string
          id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "planning_task_dependencies_depends_on_task_id_fkey"
            columns: ["depends_on_task_id"]
            isOneToOne: false
            referencedRelation: "planning_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_task_dependencies_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "planning_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      planning_tasks: {
        Row: {
          assignee_id: string | null
          auto_completed_by_cascade_at: string | null
          cascade_sop_template_id: string | null
          cascade_venue_id: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          due_date: string
          due_date_manually_overridden: boolean
          id: string
          is_blocked: boolean
          manually_assigned: boolean
          notes: string | null
          parent_task_id: string | null
          planning_item_id: string
          sop_section: string | null
          sop_t_minus_days: number | null
          sop_template_task_id: string | null
          sort_order: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          auto_completed_by_cascade_at?: string | null
          cascade_sop_template_id?: string | null
          cascade_venue_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          due_date: string
          due_date_manually_overridden?: boolean
          id?: string
          is_blocked?: boolean
          manually_assigned?: boolean
          notes?: string | null
          parent_task_id?: string | null
          planning_item_id: string
          sop_section?: string | null
          sop_t_minus_days?: number | null
          sop_template_task_id?: string | null
          sort_order?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          auto_completed_by_cascade_at?: string | null
          cascade_sop_template_id?: string | null
          cascade_venue_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string
          due_date_manually_overridden?: boolean
          id?: string
          is_blocked?: boolean
          manually_assigned?: boolean
          notes?: string | null
          parent_task_id?: string | null
          planning_item_id?: string
          sop_section?: string | null
          sop_t_minus_days?: number | null
          sop_template_task_id?: string | null
          sort_order?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "planning_tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_tasks_cascade_sop_template_id_fkey"
            columns: ["cascade_sop_template_id"]
            isOneToOne: false
            referencedRelation: "sop_task_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_tasks_cascade_venue_id_fkey"
            columns: ["cascade_venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "planning_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_tasks_planning_item_id_fkey"
            columns: ["planning_item_id"]
            isOneToOne: false
            referencedRelation: "planning_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_tasks_sop_template_task_id_fkey"
            columns: ["sop_template_task_id"]
            isOneToOne: false
            referencedRelation: "sop_task_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      short_links: {
        Row: {
          clicks: number
          code: string
          created_at: string
          created_by: string | null
          destination: string
          expires_at: string | null
          id: string
          link_type: string
          name: string
          parent_link_id: string | null
          touchpoint: string | null
          updated_at: string
        }
        Insert: {
          clicks?: number
          code: string
          created_at?: string
          created_by?: string | null
          destination: string
          expires_at?: string | null
          id?: string
          link_type?: string
          name: string
          parent_link_id?: string | null
          touchpoint?: string | null
          updated_at?: string
        }
        Update: {
          clicks?: number
          code?: string
          created_at?: string
          created_by?: string | null
          destination?: string
          expires_at?: string | null
          id?: string
          link_type?: string
          name?: string
          parent_link_id?: string | null
          touchpoint?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "short_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "short_links_parent_link_id_fkey"
            columns: ["parent_link_id"]
            isOneToOne: false
            referencedRelation: "short_links"
            referencedColumns: ["id"]
          },
        ]
      }
      slt_members: {
        Row: {
          added_at: string
          added_by: string | null
          id: string
          user_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          id?: string
          user_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "slt_members_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slt_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_campaign_sends: {
        Row: {
          attempt_count: number
          claimed_at: string
          converted_at: string | null
          customer_id: string
          event_id: string
          failed_at: string | null
          id: string
          last_error: string | null
          next_retry_at: string | null
          reply_code: string | null
          sent_at: string | null
          status: string
          twilio_sid: string | null
          wave: number
        }
        Insert: {
          attempt_count?: number
          claimed_at?: string
          converted_at?: string | null
          customer_id: string
          event_id: string
          failed_at?: string | null
          id?: string
          last_error?: string | null
          next_retry_at?: string | null
          reply_code?: string | null
          sent_at?: string | null
          status?: string
          twilio_sid?: string | null
          wave: number
        }
        Update: {
          attempt_count?: number
          claimed_at?: string
          converted_at?: string | null
          customer_id?: string
          event_id?: string
          failed_at?: string | null
          id?: string
          last_error?: string | null
          next_retry_at?: string | null
          reply_code?: string | null
          sent_at?: string | null
          status?: string
          twilio_sid?: string | null
          wave?: number
        }
        Relationships: [
          {
            foreignKeyName: "sms_campaign_sends_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_campaign_sends_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_inbound_messages: {
        Row: {
          body: string
          booking_id: string | null
          from_number: string
          id: string
          processed_at: string
          result: string
          twilio_message_sid: string
        }
        Insert: {
          body: string
          booking_id?: string | null
          from_number: string
          id?: string
          processed_at?: string
          result?: string
          twilio_message_sid: string
        }
        Update: {
          body?: string
          booking_id?: string | null
          from_number?: string
          id?: string
          processed_at?: string
          result?: string
          twilio_message_sid?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_inbound_messages_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "event_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_sections: {
        Row: {
          created_at: string
          default_assignee_ids: string[]
          id: string
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_assignee_ids?: string[]
          id?: string
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_assignee_ids?: string[]
          id?: string
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      sop_task_dependencies: {
        Row: {
          created_at: string
          depends_on_template_id: string
          id: string
          task_template_id: string
        }
        Insert: {
          created_at?: string
          depends_on_template_id: string
          id?: string
          task_template_id: string
        }
        Update: {
          created_at?: string
          depends_on_template_id?: string
          id?: string
          task_template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_task_dependencies_depends_on_template_id_fkey"
            columns: ["depends_on_template_id"]
            isOneToOne: false
            referencedRelation: "sop_task_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_task_dependencies_task_template_id_fkey"
            columns: ["task_template_id"]
            isOneToOne: false
            referencedRelation: "sop_task_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_task_templates: {
        Row: {
          created_at: string
          default_assignee_ids: string[]
          expansion_strategy: string
          id: string
          phase: string
          section_id: string
          sort_order: number
          t_minus_days: number
          t_plus_days: number | null
          template_key: string | null
          title: string
          updated_at: string
          venue_filter: string | null
        }
        Insert: {
          created_at?: string
          default_assignee_ids?: string[]
          expansion_strategy?: string
          id?: string
          phase?: string
          section_id: string
          sort_order?: number
          t_minus_days?: number
          t_plus_days?: number | null
          template_key?: string | null
          title: string
          updated_at?: string
          venue_filter?: string | null
        }
        Update: {
          created_at?: string
          default_assignee_ids?: string[]
          expansion_strategy?: string
          id?: string
          phase?: string
          section_id?: string
          sort_order?: number
          t_minus_days?: number
          t_plus_days?: number | null
          template_key?: string | null
          title?: string
          updated_at?: string
          venue_filter?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sop_task_templates_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sop_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          deactivated_at: string | null
          deactivated_by: string | null
          debrief_pinned: boolean
          email: string
          full_name: string | null
          id: string
          is_central_events_lead: boolean
          planning_queue_pinned: boolean
          previous_role: string | null
          role: string
          sop_drawer_pinned: boolean
          todo_digest_frequency: string
          todo_digest_last_sent_on: string | null
          updated_at: string
          venue_id: string | null
          weekly_digest_last_sent_on: string | null
        }
        Insert: {
          created_at?: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          debrief_pinned?: boolean
          email: string
          full_name?: string | null
          id: string
          is_central_events_lead?: boolean
          planning_queue_pinned?: boolean
          previous_role?: string | null
          role: string
          sop_drawer_pinned?: boolean
          todo_digest_frequency?: string
          todo_digest_last_sent_on?: string | null
          updated_at?: string
          venue_id?: string | null
          weekly_digest_last_sent_on?: string | null
        }
        Update: {
          created_at?: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          debrief_pinned?: boolean
          email?: string
          full_name?: string | null
          id?: string
          is_central_events_lead?: boolean
          planning_queue_pinned?: boolean
          previous_role?: string | null
          role?: string
          sop_drawer_pinned?: boolean
          todo_digest_frequency?: string
          todo_digest_last_sent_on?: string | null
          updated_at?: string
          venue_id?: string | null
          weekly_digest_last_sent_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_deactivated_by_fkey"
            columns: ["deactivated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_calendar_notes: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          detail: string | null
          end_date: string | null
          id: string
          start_date: string
          title: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          detail?: string | null
          end_date?: string | null
          id?: string
          start_date: string
          title: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          detail?: string | null
          end_date?: string | null
          id?: string
          start_date?: string
          title?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_calendar_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_calendar_notes_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_calendar_notes_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_default_reviewers: {
        Row: {
          created_at: string
          id: string
          reviewer_id: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          reviewer_id: string
          venue_id: string
        }
        Update: {
          created_at?: string
          id?: string
          reviewer_id?: string
          venue_id?: string
        }
        Relationships: []
      }
      venue_opening_hours: {
        Row: {
          availability: string
          close_time: string | null
          created_at: string
          day_of_week: number
          id: string
          is_closed: boolean
          open_time: string | null
          service_type_id: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          availability?: string
          close_time?: string | null
          created_at?: string
          day_of_week: number
          id?: string
          is_closed?: boolean
          open_time?: string | null
          service_type_id: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          availability?: string
          close_time?: string | null
          created_at?: string
          day_of_week?: number
          id?: string
          is_closed?: boolean
          open_time?: string | null
          service_type_id?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_opening_hours_service_type_id_fkey"
            columns: ["service_type_id"]
            isOneToOne: false
            referencedRelation: "venue_service_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_opening_hours_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_opening_override_venues: {
        Row: {
          override_id: string
          venue_id: string
        }
        Insert: {
          override_id: string
          venue_id: string
        }
        Update: {
          override_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_opening_override_venues_override_id_fkey"
            columns: ["override_id"]
            isOneToOne: false
            referencedRelation: "venue_opening_overrides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_opening_override_venues_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_opening_overrides: {
        Row: {
          availability: string
          close_time: string | null
          created_at: string
          created_by: string | null
          id: string
          is_closed: boolean
          note: string | null
          open_time: string | null
          override_date: string
          service_type_id: string
          updated_at: string
        }
        Insert: {
          availability?: string
          close_time?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_closed?: boolean
          note?: string | null
          open_time?: string | null
          override_date: string
          service_type_id: string
          updated_at?: string
        }
        Update: {
          availability?: string
          close_time?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_closed?: boolean
          note?: string | null
          open_time?: string | null
          override_date?: string
          service_type_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_opening_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_opening_overrides_service_type_id_fkey"
            columns: ["service_type_id"]
            isOneToOne: false
            referencedRelation: "venue_service_types"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_service_types: {
        Row: {
          created_at: string
          display_order: number
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          name?: string
        }
        Relationships: []
      }
      venue_services: {
        Row: {
          created_at: string
          service_type_id: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          service_type_id: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          created_at?: string
          service_type_id?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_services_service_type_id_fkey"
            columns: ["service_type_id"]
            isOneToOne: false
            referencedRelation: "venue_service_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_services_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          address: string | null
          capacity: number | null
          category: string
          created_at: string
          default_approver_id: string | null
          default_manager_responsible_id: string | null
          google_review_url: string | null
          id: string
          is_internal: boolean
          name: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          capacity?: number | null
          category?: string
          created_at?: string
          default_approver_id?: string | null
          default_manager_responsible_id?: string | null
          google_review_url?: string | null
          id?: string
          is_internal?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          capacity?: number | null
          category?: string
          created_at?: string
          default_approver_id?: string | null
          default_manager_responsible_id?: string | null
          google_review_url?: string | null
          id?: string
          is_internal?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "venues_default_manager_responsible_id_fkey"
            columns: ["default_manager_responsible_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venues_default_reviewer_id_fkey"
            columns: ["default_approver_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_digest_logs: {
        Row: {
          id: string
          payload: Json
          sent_at: string
        }
        Insert: {
          id?: string
          payload: Json
          sent_at?: string
        }
        Update: {
          id?: string
          payload?: Json
          sent_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assign_reviewer: {
        Args: { p_event_id: string; p_reviewer_id: string }
        Returns: undefined
      }
      cascade_internal_bypass: { Args: never; Returns: boolean }
      central_events_lead_ids: { Args: never; Returns: string[] }
      cleanup_auth_records: { Args: never; Returns: undefined }
      create_booking:
        | {
            Args: {
              p_email: string
              p_event_id: string
              p_first_name: string
              p_last_name: string
              p_mobile: string
              p_ticket_count: number
            }
            Returns: Json
          }
        | {
            Args: {
              p_customer_notes: string
              p_email: string
              p_event_id: string
              p_first_name: string
              p_last_name: string
              p_mobile: string
              p_ticket_count: number
            }
            Returns: Json
          }
      create_booking_from_campaign: {
        Args: { p_campaign_send_id: string; p_ticket_count: number }
        Returns: Json
      }
      create_multi_venue_event_drafts: {
        Args: { p_idempotency_key: string; p_payload: Json }
        Returns: Json
      }
      create_multi_venue_event_proposals: {
        Args: { p_idempotency_key: string; p_payload: Json }
        Returns: Json
      }
      create_multi_venue_planning_items: {
        Args: { p_idempotency_key: string; p_payload: Json }
        Returns: Json
      }
      create_paid_booking:
        | {
            Args: {
              p_email: string
              p_event_id: string
              p_first_name: string
              p_last_name: string
              p_mobile: string
              p_ticket_count: number
            }
            Returns: Json
          }
        | {
            Args: {
              p_customer_notes: string
              p_email: string
              p_event_id: string
              p_first_name: string
              p_last_name: string
              p_mobile: string
              p_ticket_count: number
            }
            Returns: Json
          }
      current_user_assigned_to_planning_task: {
        Args: { p_task_id: string }
        Returns: boolean
      }
      current_user_role: { Args: never; Returns: string }
      current_user_venue_id: { Args: never; Returns: string }
      ensure_debrief_sop_task: {
        Args: {
          p_created_by: string
          p_planning_item_id: string
          p_target_date: string
        }
        Returns: number
      }
      event_visible_to_current_user: {
        Args: { p_event_id: string; p_primary_venue_id: string }
        Returns: boolean
      }
      extract_event_performer_name: {
        Args: {
          event_type_value: string
          notes_value: string
          title_value: string
        }
        Returns: string
      }
      generate_sop_checklist: {
        Args: {
          p_created_by: string
          p_planning_item_id: string
          p_target_date: string
        }
        Returns: number
      }
      generate_sop_checklist_v2: {
        Args: {
          p_created_by: string
          p_planning_item_id: string
          p_target_date: string
        }
        Returns: Json
      }
      get_campaign_audience: {
        Args: {
          p_event_id: string
          p_event_type: string
          p_venue_id: string
          p_wave: number
        }
        Returns: {
          customer_id: string
          first_name: string
          mobile: string
        }[]
      }
      get_post_event_bookings: {
        Args: never
        Returns: {
          booking_id: string
          event_slug: string
          event_start: string
          event_title: string
          first_name: string
          mobile: string
          venue_google_review: string
          venue_name: string
        }[]
      }
      get_reminder_bookings: {
        Args: never
        Returns: {
          booking_id: string
          event_start: string
          event_title: string
          first_name: string
          mobile: string
          venue_name: string
        }[]
      }
      increment_link_clicks: { Args: { p_code: string }; Returns: undefined }
      list_customers_with_stats: {
        Args: { p_opt_in_only: boolean; p_search: string; p_venue_id: string }
        Returns: {
          booking_count: number
          created_at: string
          email: string
          first_name: string
          first_seen: string
          id: string
          last_name: string
          marketing_opt_in: boolean
          mobile: string
          ticket_count: number
          updated_at: string
        }[]
      }
      next_event_version: { Args: { p_event_id: string }; Returns: number }
      planning_item_visible_to_current_user: {
        Args: { p_item_id: string; p_primary_venue_id: string }
        Returns: boolean
      }
      planning_item_writable_to_current_user: {
        Args: { p_item_id: string; p_primary_venue_id: string }
        Returns: boolean
      }
      pre_approve_event_proposal: {
        Args: { p_admin_id: string; p_event_id: string }
        Returns: Json
      }
      propagate_sop_template_assignees: {
        Args: { p_new_assignee_ids: string[]; p_template_id: string }
        Returns: number
      }
      propose_event_draft: {
        Args: {
          p_idempotency_key: string
          p_operation_id: string
          p_payload: Json
        }
        Returns: Json
      }
      reassign_and_deactivate_user: {
        Args: {
          p_caller_id: string
          p_reassign_to_id: string
          p_target_id: string
        }
        Returns: undefined
      }
      reassign_user_content: {
        Args: { p_from_id: string; p_to_id: string }
        Returns: undefined
      }
      recalculate_sop_dates: {
        Args: { p_new_target_date: string; p_planning_item_id: string }
        Returns: number
      }
      reject_event_proposal: {
        Args: { p_admin_id: string; p_event_id: string; p_reason: string }
        Returns: undefined
      }
      save_event_draft: {
        Args: {
          p_expected_updated_at?: string
          p_idempotency_key: string
          p_operation_id: string
          p_payload: Json
        }
        Returns: Json
      }
      set_event_primary_venue: {
        Args: { p_event_id: string; p_venue_id: string }
        Returns: undefined
      }
      set_event_venues: {
        Args: { p_event_id: string; p_venue_ids: string[] }
        Returns: undefined
      }
      set_planning_item_primary_venue: {
        Args: { p_item_id: string; p_venue_id: string }
        Returns: undefined
      }
      set_planning_item_venues: {
        Args: { p_item_id: string; p_venue_ids: string[] }
        Returns: undefined
      }
      submit_event_for_review: {
        Args: {
          p_assignee_id?: string
          p_event_id: string
          p_expected_updated_at?: string
          p_idempotency_key: string
          p_operation_id: string
        }
        Returns: Json
      }
      sync_event_artists: {
        Args: { p_actor_id: string; p_artist_ids: string[]; p_event_id: string }
        Returns: undefined
      }
      transfer_booking: {
        Args: {
          p_admin_user_id: string
          p_idempotency_key: string
          p_reason: string
          p_source_booking_id: string
          p_target_event_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      event_status:
        | "draft"
        | "submitted"
        | "needs_revisions"
        | "approved"
        | "rejected"
        | "published"
        | "completed"
      user_role: "venue_manager" | "reviewer" | "central_planner" | "executive"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      event_status: [
        "draft",
        "submitted",
        "needs_revisions",
        "approved",
        "rejected",
        "published",
        "completed",
      ],
      user_role: ["venue_manager", "reviewer", "central_planner", "executive"],
    },
  },
} as const
