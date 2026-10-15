import type { SerializedScrollIntoViewOptions } from "../expression/serialized";
import { Bool } from "./bool";

export class BrowserActionError extends Error {
	constructor(
		private readonly reason: "disconnected" | "unsupported" | "invalid-state",
	) {
		super(`Browser action failed: ${reason}`);
	}

	is_disconnected(): Bool {
		return new Bool(this.reason === "disconnected");
	}

	is_unsupported(): Bool {
		return new Bool(this.reason === "unsupported");
	}

	is_invalid_state(): Bool {
		return new Bool(this.reason === "invalid-state");
	}
}

/** Typed Rust configuration captured as native scroll options. */
export class ScrollIntoViewOptions {
	readonly native: Pick<
		SerializedScrollIntoViewOptions,
		"block" | "inline" | "behavior"
	>;

	constructor(value: SerializedScrollIntoViewOptions) {
		const alignments = ["start", "center", "end", "nearest"];
		if (
			!alignments.includes(value.block) ||
			!alignments.includes(value.inline) ||
			!["auto", "instant", "smooth"].includes(value.behavior)
		) {
			throw new Error("Invalid scroll options");
		}
		this.native = {
			block: value.block,
			inline: value.inline,
			behavior: value.behavior,
		};
	}

	clone(): ScrollIntoViewOptions {
		return new ScrollIntoViewOptions(this.dehydrate());
	}

	dehydrate(): SerializedScrollIntoViewOptions {
		return {
			t: "ScrollIntoViewOptions",
			block: this.native.block,
			inline: this.native.inline,
			behavior: this.native.behavior,
		};
	}
}
