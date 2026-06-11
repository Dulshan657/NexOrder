export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '12'
  }
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          name: string
          email: string
          role: 'Admin' | 'Manager' | 'Field Sales Rep' | 'Office Sales Rep' | 'Restaurant/Hotel Customer' | 'Warehouse'
          avatar_url: string | null
          horeca_id: number | null
          created_at: string
          home_warehouse_id: number | null
        }
        Insert: {
          id: string
          name: string
          email: string
          role: 'Admin' | 'Manager' | 'Field Sales Rep' | 'Office Sales Rep' | 'Restaurant/Hotel Customer' | 'Warehouse'
          avatar_url?: string | null
          horeca_id?: number | null
          created_at?: string
          home_warehouse_id?: number | null
        }
        Update: {
          id?: string
          name?: string
          email?: string
          role?: 'Admin' | 'Manager' | 'Field Sales Rep' | 'Office Sales Rep' | 'Restaurant/Hotel Customer' | 'Warehouse'
          avatar_url?: string | null
          horeca_id?: number | null
          created_at?: string
          home_warehouse_id?: number | null
        }
        Relationships: []
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
        Relationships: []
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
          available: number
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
          reorder_point: number | null
          safety_stock: number | null
          lead_time_days: number | null
          preferred_supplier_id: number | null
          is_active: boolean
          barcode: string | null
          size_factor: number
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
          available?: number
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
          reorder_point?: number | null
          safety_stock?: number | null
          lead_time_days?: number | null
          preferred_supplier_id?: number | null
          is_active?: boolean
          barcode?: string | null
          size_factor?: number
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
          available?: number
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
          reorder_point?: number | null
          safety_stock?: number | null
          lead_time_days?: number | null
          preferred_supplier_id?: number | null
          is_active?: boolean
          barcode?: string | null
          size_factor?: number
          created_at?: string
        }
        Relationships: []
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
          is_temporary: boolean
          created_by_user_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
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
          is_temporary?: boolean
          created_by_user_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
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
          is_temporary?: boolean
          created_by_user_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Relationships: []
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
        Relationships: []
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
        Relationships: []
      }
      orders: {
        Row: {
          id: string
          horeca_id: number
          submitted_by: string
          total: number
          order_date: string
          notes: string | null
          status: 'processing' | 'processed' | 'picked' | 'packed' | 'dispatched' | 'delivered'
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
          status: 'processing' | 'processed' | 'picked' | 'packed' | 'dispatched' | 'delivered'
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
          status?: 'processing' | 'processed' | 'picked' | 'packed' | 'dispatched' | 'delivered'
          status_history?: Json
          delivery_date?: string | null
          delivery_time_slot?: 'Morning (8am-12pm)' | 'Afternoon (12pm-4pm)' | 'Evening (4pm-8pm)' | null
          verification?: Json | null
          applied_promotions?: Json | null
          created_at?: string
        }
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
      }
      scheduled_visits: {
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
        Relationships: []
      }
      visits: {
        Row: {
          id: string
          horeca_id: number
          user_id: string
          scheduled_visit_id: string | null
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
          scheduled_visit_id?: string | null
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
          scheduled_visit_id?: string | null
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
        Relationships: []
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
        Relationships: []
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
          company_logo_url: string | null
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
          company_logo_url: string | null
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
          company_logo_url?: string | null
        }
        Relationships: []
      }
      locations: {
        Row: {
          id: number
          parent_id: number | null
          kind: 'WAREHOUSE' | 'ZONE' | 'BIN' | 'SHELF'
          code: string
          name: string
          lat: number | null
          lng: number | null
          materialized_path: string
          is_active: boolean
          created_at: string
          location_type: 'bulk' | 'racked' | null
          address: string | null
          contact: string | null
          hours: string | null
          notes: string | null
          capacity_slots: number | null
          slot_kind: 'pallet' | 'carton' | null
        }
        Insert: {
          id?: number
          parent_id?: number | null
          kind: 'WAREHOUSE' | 'ZONE' | 'BIN' | 'SHELF'
          code: string
          name: string
          lat?: number | null
          lng?: number | null
          materialized_path: string
          is_active?: boolean
          created_at?: string
          location_type?: 'bulk' | 'racked' | null
          address?: string | null
          contact?: string | null
          hours?: string | null
          notes?: string | null
          capacity_slots?: number | null
          slot_kind?: 'pallet' | 'carton' | null
        }
        Update: {
          id?: number
          parent_id?: number | null
          kind?: 'WAREHOUSE' | 'ZONE' | 'BIN' | 'SHELF'
          code?: string
          name?: string
          lat?: number | null
          lng?: number | null
          materialized_path?: string
          is_active?: boolean
          created_at?: string
          location_type?: 'bulk' | 'racked' | null
          address?: string | null
          contact?: string | null
          hours?: string | null
          notes?: string | null
          capacity_slots?: number | null
          slot_kind?: 'pallet' | 'carton' | null
        }
        Relationships: []
      }
      product_home_bins: {
        Row: {
          id: number
          product_id: number
          warehouse_id: number
          bin_id: number
          created_at: string
        }
        Insert: {
          id?: number
          product_id: number
          warehouse_id: number
          bin_id: number
          created_at?: string
        }
        Update: {
          id?: number
          product_id?: number
          warehouse_id?: number
          bin_id?: number
          created_at?: string
        }
        Relationships: []
      }
      batches: {
        Row: {
          id: number
          product_id: number
          lot_code: string
          expiry_date: string | null
          barcode: string | null
          supplier_id: number | null
          received_at: string
          created_at: string
        }
        Insert: {
          id?: number
          product_id: number
          lot_code: string
          expiry_date?: string | null
          barcode?: string | null
          supplier_id?: number | null
          received_at?: string
          created_at?: string
        }
        Update: {
          id?: number
          product_id?: number
          lot_code?: string
          expiry_date?: string | null
          barcode?: string | null
          supplier_id?: number | null
          received_at?: string
          created_at?: string
        }
        Relationships: []
      }
      inventory_balances: {
        Row: {
          id: number
          product_id: number
          location_id: number
          batch_id: number | null
          on_hand: number
          allocated: number
          available: number
          updated_at: string
        }
        Insert: {
          id?: number
          product_id: number
          location_id: number
          batch_id?: number | null
          on_hand?: number
          allocated?: number
          updated_at?: string
        }
        Update: {
          id?: number
          product_id?: number
          location_id?: number
          batch_id?: number | null
          on_hand?: number
          allocated?: number
          updated_at?: string
        }
        Relationships: []
      }
      inventory_movements: {
        Row: {
          id: number
          product_id: number
          location_id: number
          batch_id: number | null
          qty_delta: number
          movement_type: 'receipt' | 'allocate' | 'deallocate' | 'pick' | 'adjustment' | 'stocktake_variance' | 'transfer_out' | 'transfer_in'
          ref_type: string | null
          ref_id: string | null
          actor_id: string | null
          reason: string | null
          supplier_id: number | null
          created_at: string
        }
        Insert: {
          id?: number
          product_id: number
          location_id: number
          batch_id?: number | null
          qty_delta: number
          movement_type: 'receipt' | 'allocate' | 'deallocate' | 'pick' | 'adjustment' | 'stocktake_variance' | 'transfer_out' | 'transfer_in'
          ref_type?: string | null
          ref_id?: string | null
          actor_id?: string | null
          reason?: string | null
          supplier_id?: number | null
          created_at?: string
        }
        Update: {
          id?: number
          product_id?: number
          location_id?: number
          batch_id?: number | null
          qty_delta?: number
          movement_type?: 'receipt' | 'allocate' | 'deallocate' | 'pick' | 'adjustment' | 'stocktake_variance' | 'transfer_out' | 'transfer_in'
          ref_type?: string | null
          ref_id?: string | null
          actor_id?: string | null
          reason?: string | null
          supplier_id?: number | null
          created_at?: string
        }
        Relationships: []
      }
      goods_receipts: {
        Row: {
          id: number
          location_id: number
          supplier_id: number | null
          reference: string | null
          received_date: string
          received_by: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: number
          location_id: number
          supplier_id?: number | null
          reference?: string | null
          received_date?: string
          received_by?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: number
          location_id?: number
          supplier_id?: number | null
          reference?: string | null
          received_date?: string
          received_by?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      order_documents: {
        Row: {
          id: number
          order_id: string
          doc_type: 'pick_slip' | 'dispatch_advice'
          storage_path: string
          generated_by: string | null
          generated_at: string
          location_id: number | null
        }
        Insert: {
          id?: number
          order_id: string
          doc_type: 'pick_slip' | 'dispatch_advice'
          storage_path: string
          generated_by?: string | null
          generated_at?: string
          location_id?: number | null
        }
        Update: {
          id?: number
          order_id?: string
          doc_type?: 'pick_slip' | 'dispatch_advice'
          storage_path?: string
          generated_by?: string | null
          generated_at?: string
          location_id?: number | null
        }
        Relationships: []
      }
      order_fulfillments: {
        Row: {
          id: number
          order_id: string
          location_id: number
          status: 'processed' | 'picked' | 'packed' | 'dispatched' | 'delivered'
          status_history: Json
          created_at: string
        }
        Insert: {
          id?: number
          order_id: string
          location_id: number
          status?: 'processed' | 'picked' | 'packed' | 'dispatched' | 'delivered'
          status_history?: Json
          created_at?: string
        }
        Update: {
          id?: number
          order_id?: string
          location_id?: number
          status?: 'processed' | 'picked' | 'packed' | 'dispatched' | 'delivered'
          status_history?: Json
          created_at?: string
        }
        Relationships: []
      }
      pick_progress: {
        Row: {
          id: number
          order_id: string
          order_item_id: number
          location_id: number
          batch_id: number | null
          picked_qty: number
          picked_by: string | null
          picked_at: string
        }
        Insert: {
          id?: number
          order_id: string
          order_item_id: number
          location_id: number
          batch_id?: number | null
          picked_qty: number
          picked_by?: string | null
          picked_at?: string
        }
        Update: {
          id?: number
          order_id?: string
          order_item_id?: number
          location_id?: number
          batch_id?: number | null
          picked_qty?: number
          picked_by?: string | null
          picked_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      inv_default_location: {
        Args: Record<string, never>
        Returns: number
      }
      inv_reserve_order: {
        Args: { p_order_id: string; p_items: Json; p_actor?: string; p_allow_partial?: boolean }
        Returns: undefined
      }
      inv_release_reservation: {
        Args: { p_order_id: string; p_actor?: string }
        Returns: undefined
      }
      inv_pick_order_line: {
        Args: { p_order_item_id: number; p_picked_qty: number; p_actor?: string }
        Returns: Json
      }
      inv_receive_stock: {
        Args: { p_lines: Json; p_actor?: string }
        Returns: Json
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
