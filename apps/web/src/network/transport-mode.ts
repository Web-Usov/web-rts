/** `/?transport=local` selects LocalGameTransport. Any other URL stays remote. */
export function isLocalTransportSearch(search: string): boolean {
  return new URLSearchParams(search).get("transport") === "local";
}
