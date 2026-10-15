import type { MorphOptions } from "./morph";

/** The dev client asks the loaded runtime to participate in a refresh. */
export const DEV_RUNTIME_EVENT = "topcoat:dev-runtime:v3";

export interface DevRuntime {
	/** Renders with current signals; `finished` covers consuming the stream. */
	request(signal: AbortSignal, finished: Promise<void>): Promise<Response>;
	/** Releases bindings, updates the document, then hydrates it again. */
	replace(update: (options: MorphOptions) => void): void;
	/** Applies a live update belonging to this refresh's render. */
	swap(region: string, html: string): void;
}

export interface DevRuntimeDetail {
	runtime?: DevRuntime;
}
