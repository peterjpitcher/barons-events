export function cn(...inputs: Array<string | boolean | null | undefined>): string {
  return inputs.filter(Boolean).join(" ");
}
