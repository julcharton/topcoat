import { Bool } from "./bool";
import {
	BrowserActionError,
	type ScrollIntoViewOptions,
} from "./browser-action";
import { EventTarget } from "./event";
import { Option } from "./option";
import { Result } from "./result";
import type { Str } from "./string";

/** A resolved snapshot. Native resources deliberately have no serialization. */
export class ElementHandle {
	constructor(readonly node: HTMLElement) {}

	clone(): ElementHandle {
		return new ElementHandle(this.node);
	}

	focus(preventScroll: Bool): Result<Bool, BrowserActionError> {
		return this.run(() => {
			if (typeof this.node.focus !== "function")
				throw new BrowserActionError("unsupported");
			const prevent = preventScroll.dehydrate();
			// WebKit can scroll newly inserted elements after their first layout,
			// ignoring preventScroll. Resolve layout before requesting focus.
			if (prevent) this.node.getBoundingClientRect();
			this.node.focus({ preventScroll: prevent });
			const root = this.node.getRootNode();
			return new Bool(
				(root instanceof Document || root instanceof ShadowRoot) &&
					root.activeElement === this.node,
			);
		});
	}

	scroll_into_view(
		options: ScrollIntoViewOptions,
	): Result<void, BrowserActionError> {
		return this.run(() => {
			if (typeof this.node.scrollIntoView !== "function")
				throw new BrowserActionError("unsupported");
			this.node.scrollIntoView(options.native);
		});
	}

	contains(target: EventTarget): Result<Bool, BrowserActionError> {
		return this.run(
			() =>
				new Bool(
					target.inner instanceof Node && this.node.contains(target.inner),
				),
		);
	}

	show_popover(): Result<Bool, BrowserActionError> {
		return this.run(() => {
			if (typeof this.node.showPopover !== "function")
				throw new BrowserActionError("unsupported");
			this.node.showPopover();
			return new Bool(this.node.matches(":popover-open"));
		});
	}

	hide_popover(): Result<Bool, BrowserActionError> {
		return this.run(() => {
			if (typeof this.node.hidePopover !== "function")
				throw new BrowserActionError("unsupported");
			this.node.hidePopover();
			return new Bool(this.node.matches(":popover-open"));
		});
	}

	set_custom_validity(message: Str): Result<void, BrowserActionError> {
		return this.run(() => {
			const control = this.formControl();
			if (typeof control.setCustomValidity !== "function")
				throw new BrowserActionError("unsupported");
			control.setCustomValidity(message.toString());
		});
	}

	report_validity(): Result<Bool, BrowserActionError> {
		return this.run(() => {
			const control = this.formControl();
			if (typeof control.reportValidity !== "function")
				throw new BrowserActionError("unsupported");
			return new Bool(control.reportValidity());
		});
	}

	form_target(): Result<Option<EventTarget>, BrowserActionError> {
		return this.run(() => {
			const form = this.formControl().form;
			return form === null ? Option.none() : Option.some(new EventTarget(form));
		});
	}

	show_modal(): Result<Bool, BrowserActionError> {
		return this.run(() => {
			const dialog = this.dialog();
			if (typeof dialog.showModal !== "function")
				throw new BrowserActionError("unsupported");
			dialog.showModal();
			return new Bool(dialog.open);
		});
	}

	close(returnValue: Str): Result<void, BrowserActionError> {
		return this.run(() => {
			const dialog = this.dialog();
			if (typeof dialog.close !== "function")
				throw new BrowserActionError("unsupported");
			dialog.close(returnValue.toString());
		});
	}

	private formControl():
		| HTMLInputElement
		| HTMLSelectElement
		| HTMLTextAreaElement {
		if (
			this.node instanceof HTMLInputElement ||
			this.node instanceof HTMLSelectElement ||
			this.node instanceof HTMLTextAreaElement
		) {
			return this.node;
		}
		throw new BrowserActionError("unsupported");
	}

	private dialog(): HTMLDialogElement {
		if (this.node instanceof HTMLDialogElement) return this.node;
		throw new BrowserActionError("unsupported");
	}

	private run<T>(action: () => T): Result<T, BrowserActionError> {
		try {
			if (!this.node.isConnected) throw new BrowserActionError("disconnected");
			const value = action();
			if (!this.node.isConnected) throw new BrowserActionError("disconnected");
			return Result.from_ok(value);
		} catch (error) {
			if (error instanceof BrowserActionError) return Result.from_err(error);
			if (
				error instanceof DOMException &&
				(error.name === "InvalidStateError" ||
					error.name === "NotSupportedError")
			) {
				return Result.from_err(
					new BrowserActionError(
						this.node.isConnected ? "invalid-state" : "disconnected",
					),
				);
			}
			throw error;
		}
	}
}
