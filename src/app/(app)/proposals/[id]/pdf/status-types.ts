/**
 * Re-export the PDF + storage provider status types for the client
 * panel. We can't import server-only modules into a "use client"
 * file directly, so this thin re-export keeps the boundaries clean.
 */
export type { PdfProviderStatus, PdfProviderName } from "@/lib/pdf";
export type {
  StorageProviderStatus,
  StorageProviderName,
} from "@/lib/storage";
