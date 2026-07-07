// Encode raw bytes to a base64 string in Deno without blowing the call stack on
// large buffers (String.fromCharCode(...bigArray) overflows). Chunked apply keeps
// it safe for multi-megabyte images/PDFs. Shared by the extraction pipelines.
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
