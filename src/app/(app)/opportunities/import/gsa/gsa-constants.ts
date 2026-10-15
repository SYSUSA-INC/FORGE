/**
 * BL-STAB-2d — shared by the GSA paste page and its server action (a
 * "use server" file may export only async functions).
 *
 * Attachments go from the browser straight to storage, so this is a
 * count, not a size budget; each file's own limit is the upload policy's.
 */
export const GSA_MAX_ATTACHMENTS = 20;
