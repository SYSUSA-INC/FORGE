/**
 * BL-STAB-2 — the browser half of an upload straight to storage. Used only
 * from client components. Uses XMLHttpRequest rather than fetch because
 * fetch cannot report upload progress.
 *
 * The presigned URL is a credential for one object until it expires: it is
 * never logged or sent anywhere but storage.
 */

export type PutResult = { status: number; bodyText: string };

/**
 * PUT `body` to a presigned URL, reporting progress. Sends only the headers
 * the server signed (the browser sets Content-Length itself from the body)
 * and no cookies. Resolves with status 0 when the request got no answer
 * (network failure, or the bucket's CORS rule refused this origin);
 * rejects only when aborted through `signal`.
 */
export function putWithProgress(i: {
  url: string;
  headers: Record<string, string>;
  body: Blob;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<PutResult> {
  return new Promise((resolve, reject) => {
    if (i.signal?.aborted) {
      reject(new DOMException("Upload cancelled", "AbortError"));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", i.url, true);
    xhr.withCredentials = false;
    for (const [name, value] of Object.entries(i.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) i.onProgress?.(e.loaded, e.total);
    };
    const onAbort = () => xhr.abort();
    i.signal?.addEventListener("abort", onAbort, { once: true });
    const finish = (result: PutResult | null) => {
      i.signal?.removeEventListener("abort", onAbort);
      if (result) resolve(result);
      else reject(new DOMException("Upload cancelled", "AbortError"));
    };
    xhr.onload = () => finish({ status: xhr.status, bodyText: typeof xhr.responseText === "string" ? xhr.responseText.slice(0, 2_000) : "" });
    xhr.onerror = () => finish({ status: 0, bodyText: "" });
    xhr.ontimeout = () => finish({ status: 0, bodyText: "" });
    xhr.onabort = () => finish(null);
    xhr.send(i.body);
  });
}
