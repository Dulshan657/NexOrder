export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          name: string
          email: string
          role: 'Admin' | 'Manager' | 'Field Sales Rep' | 'Office Sales Rep' | 'Restaurant/Hotel Customer'
          avatar_url: string | null
          horeca_id: number | null
          created_at: string
        }
        Insert: {
          id: string
          name: string
          email: string
          role: 'Admin' | 'Manager' | 'Field Sales Rep' | 'Office Sales Rep' | 'Restaurant/Hotel Customer'
          avatar_url?: string | null
          horeca_id?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          email?: string
          role?: 'Admin' | 'Manager' | 'Field Sales Rep' | 'Office Sales Rep' | 'Restaurant/Hotel Customer'
          avatar_url?: string | null
          horeca_id?: number | null
          created_at?: string
        }
      }
      suppliers: {
        Row: {
          id: number
          name: string
          contact_person: string
          email: string
          phone: string
          created_at: string
        }
        Insert: {
          id?: number
          name: string
          contact_person: string
          email: string
          phone: string
          created_at?: string
        }
        Update: {
          id?: number
          name?: string
          contact_person?: string
          email?: string
          phone?: string
          created_at?: string
        }
      }
      products: {
        Row: {
          id: number
          sku: string
          name: string
          description: string | null
          price: number
          category: 'Coconut' | 'Meal Pastes' | 'Asian Sauces' | 'Soy Sauces' | 'Chilli Sauces' | 'Condiments' | 'Noodles' | 'Fish' | 'Satay Sauces' | 'Desserts' | 'Ready Meal Sauces' | 'Other'
          inventory: number
          image_url: string | null
          unit: string
          carton_size: number
          dietary_labels: string[] | null
          supplier_id: number
          cubic_meters_unit: number | null
          cubic_meters_carton: number | null
          length_cm: number | null
          width_cm: number | null
          height_cm: number | null
          created_at: string
        }
        Insert: {
          id?: number
          sku: string
          name: string
          description?: string | null
          price: number
          category: 'Coconut' | 'Meal Pastes' | 'Asian Sauces' | 'Soy Sauces' | 'Chilli Sauces' | 'Condiments' | 'Noodles' | 'Fish' | 'Satay Sauces' | 'Desserts' | 'Ready Meal Sauces' | 'Other'
          inventory: number
          image_url?: string | null
          unit: string
          carton_size: number
          dietary_labels?: string[] | null
          supplier_id: number
          cubic_meters_unit?: number | null
          cubic_meters_carton?: number | null
          length_cm?: number | null
          width_cm?: number | null
          height_cm?: number | null
          created_at?: string
        }
        Update: {
          id?: number
          sku?: string
          name?: string
          description?: string | null
          price?: number
          category?: 'Coconut' | 'Meal Pastes' | 'Asian Sauces' | 'Soy Sauces' | 'Chilli Sauces' | 'Condiments' | 'Noodles' | 'Fish' | 'Satay Sauces' | 'Desserts' | 'Ready Meal Sauces' | 'Other'
          inventory?: number
          image_url?: string | null
          unit?: string
          carton_size?: number
          dietary_labels?: string[] | null
          supplier_id?: number
          cubic_meters_unit?: number | null
          cubic_meters_carton?: number | null
          length_cm?: number | null
          width_cm?: number | null
          height_cm?: number | null
          created_at?: string
        }
      }
      horecas: {
        Row: {
          id: number
          name: string
          address: string
          discount_percent: number | null
          credit_limit: number | null
          show_stock_tab: boolean | null
          tier: 'Gold' | 'Silver' | 'Bronze' | null
          lat: number | null
          lng: number | null
          created_at: string
        }
        Insert: {
          id?: number
          name: string
          address: string
          discount_percent?: number | null
          credit_limit?: number | null
          show_stock_tab?: boolean | null
          tier?: 'Gold' | 'Silver' | 'Bronze' | null
          lat?: number | null
          lng?: number | null
          created_at?: string
        }
        Update: {
          id?: number
          name?: string
          address?: string
          discount_percent?: number | null
          credit_limit?: number | null
          show_stock_tab?: boolean | null
          tier?: 'Gold' | 'Silver' | 'Bronze' | null
          lat?: number | null
          lng?: number | null
          created_at?: string
        }
      }
      horeca_pricing: {
        Row: {
          id: number
          horeca_id: number
          product_id: number
          custom_price: number
        }
        Insert: {
          id?: number
          horeca_id: number
          product_id: number
          custom_price: number
        }
        Update: {
          id?: number
          horeca_id?: number
          product_id?: number
          custom_price?: number
        }
      }
      horeca_payment_methods: {
        Row: {
          id: number
          horeca_id: number
          type: 'Credit Card' | 'Bank Transfer' | 'On Account'
          details: string
          is_default: boolean
        }
        Insert: {
          id?: number
          horeca_id: number
          type: 'Credit Card' | 'Bank Transfer' | 'On Account'
          details: string
          is_default: boolean
        }
        Update: {
          id?: number
          horeca_id?: number
          type?: 'Credit Card' | 'Bank Transfer' | 'On Account'
          details?: string
          is_default?: boolean
        }
      }
      orders: {
        Row: {
          id: string
          horeca_id: number
          submitted_by: string
          total: number
          order_date: string
          notes: string | null
          status: 'processing' | 'confirmed' | 'packed' | 'shipped' | 'delivered'
          status_history: Json
          delivery_date: string | null
          delivery_time_slot: 'Morning (8am-12pm)' | 'Afternoon (12pm-4pm)' | 'Evening (4pm-8pm)' | null
          verification: Json | null
          applied_promotions: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          horeca_id: number
          submitted_by: string
          total: number
          order_date: string
          notes?: string | null
          status: 'processing' | 'confirmed' | 'packed' | 'shipped' | 'delivered'
          status_history: Json
          delivery_date?: string | null
          delivery_time_slot?: 'Morning (8am-12pm)' | 'Afternoon (12pm-4pm)' | 'Evening (4pm-8pm)' | null
          verification?: Json | null
          applied_promotions?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          horeca_id?: number
          submitted_by?: string
          total?: number
          order_date?: string
          notes?: string | null
          status?: 'processing' | 'confirmed' | 'packed' | 'shipped' | 'delivered'
          status_history?: Json
          delivery_date?: string | null
          delivery_time_slot?: 'Morning (8am-12pm)' | 'Afternoon (12pm-4pm)' | 'Evening (4pm-8pm)' | null
          verification?: Json | null
          applied_promotions?: Json | null
          created_at?: string
        }
      }
      order_items: {
        Row: {
          id: number
          order_id: string
          product_id: number
          quantity: number
          pack_size: number | null
          unit_price: number
          product_name: string
          product_sku: string
        }
        Insert: {
          id?: number
          order_id: string
          product_id: number
          quantity: number
          pack_size?: number | null
          unit_price: number
          product_name: string
          product_sku: string
        }
        Update: {
          id?: number
          order_id?: string
          product_id?: number
          quantity?: number
          pack_size?: number | null
          unit_price?: number
          product_name?: string
          product_sku?: string
        }
      }
      invoices: {
        Row: {
          id: string
          order_id: string
          horeca_id: number
          horeca_name: string
          amount: number
          due_date: string
          status: 'pending' | 'paid' | 'overdue'
          paid_date: string | null
          created_date: string
        }
        Insert: {
          id?: string
          order_id: string
          horeca_id: number
          horeca_name: string
          amount: number
          due_date: string
          status: 'pending' | 'paid' | 'overdue'
          paid_date?: string | null
          created_date: string
        }
        Update: {
          id?: string
          order_id?: string
          horeca_id?: number
          horeca_name?: string
          amount?: number
          due_date?: string
          status?: 'pending' | 'paid' | 'overdue'
          paid_date?: string | null
          created_date?: string
        }
      }
      purchase_orders: {
        Row: {
          id: string
          supplier_id: number
          total: number
          order_date: string
          status: 'Pending' | 'Submitted' | 'Completed' | 'Cancelled'
          submitted_by: string
          created_at: string
        }
        Insert: {
          id?: string
          supplier_id: number
          total: number
          order_date: string
          status: 'Pending' | 'Submitted' | 'Completed' | 'Cancelled'
          submitted_by: string
          created_at?: string
        }
        Update: {
          id?: string
          supplier_id?: number
          total?: number
          order_date?: string
          status?: 'Pending' | 'Submitted' | 'Completed' | 'Cancelled'
          submitted_by?: string
          created_at?: string
        }
      }
      purchase_order_items: {
        Row: {
          id: number
          purchase_order_id: string
          product_id: number
          product_name: string
          quantity: number
          cost: number
        }
        Insert: {
          id?: number
          purchase_order_id: string
          product_id: number
          product_name: string
          quantity: number
          cost: number
        }
        Update: {
          id?: number
          purchase_order_id?: string
          product_id?: number
          product_name?: string
          quantity?: number
          cost?: number
        }
      }
      promotions: {
        Row: {
          id: string
          name: string
          description: string | null
          type: 'percentage' | 'fixed_price' | 'bogo' | 'bundle' | 'clearance'
          percent_off: number | null
          fixed_price: number | null
          bogo_config: Json | null
          bundle_config: Json | null
          clearance_percent: number | null
          scope: Json
          targeting: Json
          min_order_value: number | null
          stack_with_horeca_pricing: boolean
          start_date: string | null
          end_date: string | null
          is_active: boolean
          created_at: string
          created_by: string
          priority: number
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          type: 'percentage' | 'fixed_price' | 'bogo' | 'bundle' | 'clearance'
          percent_off?: number | null
          fixed_price?: number | null
          bogo_config?: Json | null
          bundle_config?: Json | null
          clearance_percent?: number | null
          scope: Json
          targeting: Json
          min_order_value?: number | null
          stack_with_horeca_pricing: boolean
          start_date?: string | null
          end_date?: string | null
          is_active: boolean
          created_at?: string
          created_by: string
          priority: number
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          type?: 'percentage' | 'fixed_price' | 'bogo' | 'bundle' | 'clearance'
          percent_off?: number | null
          fixed_price?: number | null
          bogo_config?: Json | null
          bundle_config?: Json | null
          clearance_percent?: number | null
          scope?: Json
          targeting?: Json
          min_order_value?: number | null
          stack_with_horeca_pricing?: boolean
          start_date?: string | null
          end_date?: string | null
          is_active?: boolean
          created_at?: string
          created_by?: string
          priority?: number
        }
      }
      pantry_items: {
        Row: {
          id: number
          horeca_id: number
          product_id: number
          preferred_pack_size: number | null
          default_quantity: number
        }
        Insert: {
          id?: number
          horeca_id: number
          product_id: number
          preferred_pack_size?: number | null
          default_quantity: number
        }
        Update: {
          id?: number
          horeca_id?: number
          product_id?: number
          preferred_pack_size?: number | null
          default_quantity?: number
        }
      }
      sales_targets: {
        Row: {
          id: string
          user_id: string
          type: 'revenue' | 'orders' | 'new_horecas'
          target_value: number
          start_date: string
          end_date: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          type: 'revenue' | 'orders' | 'new_horecas'
          target_value: number
          start_date: string
          end_date: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          type?: 'revenue' | 'orders' | 'new_horecas'
          target_value?: number
          start_date?: string
          end_date?: string
          created_at?: string
        }
      }
      routes: {
        Row: {
          id: string
          name: string
          date: string | null
          stops: Json
          status: 'planned' | 'in_progress' | 'completed'
          created_by: string
          created_at: string
          completed_at: string | null
          assigned_to: string | null
          assigned_by: string | null
          assigned_at: string | null
          is_template: boolean | null
          template_id: string | null
          recurrence: Json | null
          change_requests: Json
        }
        Insert: {
          id?: string
          name: string
          date?: string | null
          stops: Json
          status: 'planned' | 'in_progress' | 'completed'
          created_by: string
          created_at?: string
          completed_at?: string | null
          assigned_to?: string | null
          assigned_by?: string | null
          assigned_at?: string | null
          is_template?: boolean | null
          template_id?: string | null
          recurrence?: Json | null
          change_requests: Json
        }
        Update: {
          id?: string
          name?: string
          date?: string | null
          stops?: Json
          status?: 'planned' | 'in_progress' | 'completed'
          created_by?: string
          created_at?: string
          completed_at?: string | null
          assigned_to?: string | null
          assigned_by?: string | null
          assigned_at?: string | null
          is_template?: boolean | null
          template_id?: string | null
          recurrence?: Json | null
          change_requests?: Json
        }
      }
      visits: {
        Row: {
          id: string
          horeca_id: number
          user_id: string
          route_id: string | null
          arrival_time: string
          departure_time: string | null
          outcome: 'order_placed' | 'follow_up_needed' | 'not_available' | 'no_interest' | 'stock_check_only' | null
          notes: string | null
          competitor_notes: string | null
          stock_check_notes: string | null
          next_visit_recommendation: string | null
          photos: string[] | null
          created_at: string
        }
        Insert: {
          id?: string
          horeca_id: number
          user_id: string
          route_id?: string | null
          arrival_time: string
          departure_time?: string | null
          outcome?: 'order_placed' | 'follow_up_needed' | 'not_available' | 'no_interest' | 'stock_check_only' | null
          notes?: string | null
          competitor_notes?: string | null
          stock_check_notes?: string | null
          next_visit_recommendation?: string | null
          photos?: string[] | null
          created_at?: string
        }
        Update: {
          id?: string
          horeca_id?: number
          user_id?: string
          route_id?: string | null
          arrival_time?: string
          departure_time?: string | null
          outcome?: 'order_placed' | 'follow_up_needed' | 'not_available' | 'no_interest' | 'stock_check_only' | null
          notes?: string | null
          competitor_notes?: string | null
          stock_check_notes?: string | null
          next_visit_recommendation?: string | null
          photos?: string[] | null
          created_at?: string
        }
      }
      notifications: {
        Row: {
          id: string
          type: string
          message: string
          timestamp: string
          read: boolean
          target_roles: string[] | null
          metadata: Json | null
          user_id: string | null
        }
        Insert: {
          id?: string
          type: string
          message: string
          timestamp: string
          read: boolean
          target_roles?: string[] | null
          metadata?: Json | null
          user_id?: string | null
        }
        Update: {
          id?: string
          type?: string
          message?: string
          timestamp?: string
          read?: boolean
          target_roles?: string[] | null
          metadata?: Json | null
          user_id?: string | null
        }
      }
      app_settings: {
        Row: {
          id: number
          company_name: string
          company_address: string
          company_phone: string
          company_email: string
          order_id_prefix: string
          minimum_order_value: number
          default_credit_limit: number
          carton_discount_percent: number
          low_stock_threshold: number
          currency: string
          show_stock_to_horeca: boolean
        }
        Insert: {
          id?: number
          company_name: string
          company_address: string
          company_phone: string
          company_email: string
          order_id_prefix: string
          minimum_order_value: number
          default_credit_limit: number
          carton_discount_percent: number
          low_stock_threshold: number
          currency: string
          show_stock_to_horeca: boolean
        }
        Update: {
          id?: number
          company_name?: string
          company_address?: string
          company_phone?: string
          company_email?: string
          order_id_prefix?: string
          minimum_order_value?: number
          default_credit_limit?: number
          carton_discount_percent?: number
          low_stock_threshold?: number
          currency?: string
          show_stock_to_horeca?: boolean
        }
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
