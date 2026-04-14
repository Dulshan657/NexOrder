import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type ProductRow = Database['public']['Tables']['products']['Row']
type ProductInsert = Database['public']['Tables']['products']['Insert']
type ProductUpdate = Database['public']['Tables']['products']['Update']

export async function getProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('*, suppliers(name)')
    .order('name')
  if (error) throw error
  return data
}

export async function getProductById(id: number) {
  const { data, error } = await supabase
    .from('products')
    .select('*, suppliers(name)')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function createProduct(product: ProductInsert) {
  const { data, error } = await supabase
    .from('products')
    .insert(product)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateProduct(id: number, updates: ProductUpdate) {
  const { data, error } = await supabase
    .from('products')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteProduct(id: number) {
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id)
  if (error) throw error
}
