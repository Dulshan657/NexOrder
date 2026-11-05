import { supabase } from '@/lib/supabase'
import { extractFunctionErrorMessage } from '@/lib/functionError'
import type { ImportOk } from '@/supabase/functions/_shared/qbImport/runImport'

export interface ImportPoRequest {
  action: 'preview' | 'commit'
  csvText: string
  applyChanges?: string[]
}

/** One call to `import-qb-invoices`. A refusal comes back as a thrown, readable Error. */
export async function runImportPo(request: ImportPoRequest): Promise<ImportOk> {
  const { data, error } = await supabase.functions.invoke<ImportOk>('import-qb-invoices', { body: request })
  if (error) throw new Error(await extractFunctionErrorMessage(error, 'The import could not be completed.'))
  if (!data) throw new Error('The import returned no result.')
  return data
}
