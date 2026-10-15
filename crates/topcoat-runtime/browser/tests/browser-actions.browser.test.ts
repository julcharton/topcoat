import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { compile } from "../src/expression/compile";
import { dehydrate } from "../src/expression/dehydrate";
import { newRender } from "../src/render/frames";
import { Runtime } from "../src/runtime";
import { Bool } from "../src/surrogate/bool";
import {
	type BrowserActionError,
	ScrollIntoViewOptions,
} from "../src/surrogate/browser-action";
import { type ElementHandle, ElementRef } from "../src/surrogate/element-ref";
import { EventTarget, Event as RuntimeEvent } from "../src/surrogate/event";
import type { Option } from "../src/surrogate/option";
import type { Result } from "../src/surrogate/result";
import { Str } from "../src/surrogate/string";
import fixture from "./browser-actions.json";

let runtime: Runtime;

// Keep the test iframe at native scale so scroll alignment assertions measure
// CSS pixels without Firefox's rounding under the runner's scaled viewport.
beforeAll(async () => {
	await page.viewport(800, 600);
});

beforeEach(() => {
	document.body.innerHTML = "";
	runtime = new Runtime();
});

afterEach(async () => {
	runtime.navigation.dispose();
	runtime.page.dispose();
	document.body.innerHTML = "";
	await userEvent.cleanup();
});

function action<T = Bool>(source: string) {
	return compile<() => Result<T, BrowserActionError>>(
		source,
		"browser action",
	)(runtime.context);
}

function element<T extends HTMLElement>(id: string, type: { new (): T }): T {
	const node = document.getElementById(id);
	if (!(node instanceof type)) throw new Error(`Missing ${id}`);
	return node;
}

const instant = () =>
	new ScrollIntoViewOptions({
		t: "ScrollIntoViewOptions",
		block: "start",
		inline: "nearest",
		behavior: "instant",
	});

for (const preventScroll of [true, false]) {
	it(`focuses a fresh input with prevent-scroll ${preventScroll}`, async () => {
		document.body.innerHTML =
			'<div id="scroller" style="height:100px;overflow:auto"><div style="height:1000px"></div><input id="field"><div style="height:100px"></div></div>';
		const scroller = element("scroller", HTMLDivElement);
		const input = element("field", HTMLInputElement);
		// Do not read layout before focus: this catches WebKit scrolling a new
		// element during its first layout despite the preventScroll option.
		expect(
			action(preventScroll ? fixture.focus : fixture.focus_scroll)()
				.unwrap()
				.dehydrate(),
		).toBe(true);
		expect(document.activeElement).toBe(input);
		await new Promise((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(resolve)),
		);
		if (preventScroll) {
			expect(scroller.scrollTop).toBe(0);
		} else {
			await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0);
		}
	});
}

it("reports focus refusal on disabled and inert elements", () => {
	document.body.innerHTML = '<input id="field" disabled>';
	const focus = action(fixture.focus);
	const input = element("field", HTMLInputElement);
	expect(focus().unwrap().dehydrate()).toBe(false);
	input.disabled = false;
	input.inert = true;
	expect(focus().unwrap().dehydrate()).toBe(false);
	input.inert = false;
	expect(focus().unwrap().dehydrate()).toBe(true);
});

for (const alignment of ["start", "center", "end", "nearest"] as const) {
	it(`scrolls both axes with native ${alignment} alignment`, () => {
		document.body.innerHTML =
			'<div id="scroller" style="width:200px;height:200px;overflow:scroll;position:relative"><div style="width:1600px;height:1600px"><div id="container" style="position:absolute;top:800px;left:700px;width:40px;height:40px"></div></div></div>';
		const scroller = element("scroller", HTMLDivElement);
		const target = element("container", HTMLDivElement);
		action<void>(fixture.scroll[alignment])().unwrap();
		const outer = scroller.getBoundingClientRect();
		const inner = target.getBoundingClientRect();
		const offset =
			alignment === "start"
				? 0
				: alignment === "center"
					? (scroller.clientHeight - inner.height) / 2
					: scroller.clientHeight - inner.height;
		const inlineOffset =
			alignment === "start"
				? 0
				: alignment === "center"
					? (scroller.clientWidth - inner.width) / 2
					: scroller.clientWidth - inner.width;
		expect(inner.top - outer.top).toBeCloseTo(offset, 0);
		expect(inner.left - outer.left).toBeCloseTo(inlineOffset, 0);
		if (alignment === "nearest") {
			const position = [scroller.scrollTop, scroller.scrollLeft];
			action<void>(fixture.scroll.nearest)().unwrap();
			expect([scroller.scrollTop, scroller.scrollLeft]).toEqual(position);
		}
	});
}

for (const behavior of ["auto", "smooth"] as const) {
	it(`accepts ${behavior} scrolling and reaches the native destination`, async () => {
		document.body.innerHTML =
			'<div id="scroller" style="width:200px;height:200px;overflow:auto;scroll-behavior:smooth"><div style="height:600px"></div><div id="container" style="height:30px"></div><div style="height:400px"></div></div>';
		const scroller = element("scroller", HTMLDivElement);
		action<void>(fixture.scroll[behavior])().unwrap();
		expect(scroller.scrollTop).toBe(0);
		await expect.poll(() => scroller.scrollTop).toBeCloseTo(600, 0);
	});
}

it("checks event target containment including self, outside, null, and non-Node targets", () => {
	document.body.innerHTML =
		'<div id="container"><input id="field"></div><button id="outside"></button>';
	const contains = compile<
		(event: RuntimeEvent) => Result<Bool, BrowserActionError>
	>(
		fixture.contains,
		"contains",
	)(runtime.context);
	const container = element("container", HTMLDivElement);
	for (const [target, expected] of [
		[container, true],
		[element("field", HTMLInputElement), true],
		[element("outside", HTMLButtonElement), false],
		[window, false],
		[new globalThis.EventTarget(), false],
	] as const) {
		let result: boolean | undefined;
		target.addEventListener(
			"probe",
			(event) => {
				result = contains(new RuntimeEvent(event)).unwrap().dehydrate();
			},
			{ once: true },
		);
		target.dispatchEvent(new Event("probe"));
		expect(result).toBe(expected);
	}
	expect(
		contains(new RuntimeEvent(new Event("probe")))
			.unwrap()
			.dehydrate(),
	).toBe(false);
	const handle = new ElementRef("container", "html").resolve().unwrap();
	// Mirrors a future optional related_target after its presence check.
	const related = new FocusEvent("focusout", {
		relatedTarget: element("field", HTMLInputElement),
	});
	expect(
		handle
			.contains(new EventTarget(related.relatedTarget))
			.unwrap()
			.dehydrate(),
	).toBe(true);
	expect(handle.contains(new EventTarget(null)).unwrap().dehydrate()).toBe(
		false,
	);
});

for (const kind of ["input", "select", "textarea"] as const) {
	it(`sets, reports, and clears native custom validity on ${kind}`, () => {
		document.body.innerHTML =
			'<form id="form"><input id="field"><select id="select"><option>Choice</option></select><textarea id="textarea"></textarea></form>';
		const control =
			kind === "input"
				? element("field", HTMLInputElement)
				: kind === "select"
					? element("select", HTMLSelectElement)
					: element("textarea", HTMLTextAreaElement);
		let invalid = 0;
		control.addEventListener("invalid", (event) => {
			invalid++;
			event.preventDefault();
		});
		action<void>(fixture[kind].set)().unwrap();
		expect(control.validity.customError).toBe(true);
		expect(control.validationMessage).not.toBe("");
		expect(action(fixture[kind].report)().unwrap().dehydrate()).toBe(false);
		expect(invalid).toBe(1);
		action<void>(fixture[kind].clear)().unwrap();
		expect(control.validity.customError).toBe(false);
		expect(control.validationMessage).toBe("");
		expect(action(fixture[kind].report)().unwrap().dehydrate()).toBe(true);
		action<void>(fixture[kind].set)().unwrap();
		control.disabled = true;
		expect(action(fixture[kind].report)().unwrap().dehydrate()).toBe(true);
		expect(control.validity.customError).toBe(true);
	});

	it(`returns the native ${kind} form owner for reset listeners, including external association`, () => {
		document.body.innerHTML =
			'<form id="form"><input id="field"><select id="select"></select><textarea id="textarea"></textarea></form><form id="other"></form>';
		const control =
			kind === "input"
				? element("field", HTMLInputElement)
				: kind === "select"
					? element("select", HTMLSelectElement)
					: element("textarea", HTMLTextAreaElement);
		const form = element("form", HTMLFormElement);
		const other = element("other", HTMLFormElement);
		const owner = action<Option<EventTarget>>(fixture[kind].form);
		const target = owner().unwrap().unwrap();
		expect(target.inner).toBe(form);
		expect(() => dehydrate(owner())).toThrow();
		let resets = 0;
		target.inner?.addEventListener("reset", () => {
			resets++;
		});
		form.reset();
		expect(resets).toBe(1);
		control.setAttribute("form", "other");
		expect(owner().unwrap().unwrap().inner).toBe(other);
		control.setAttribute("form", "missing");
		expect(owner().unwrap().is_none().dehydrate()).toBe(true);
		expect(() => dehydrate(target)).toThrow();
	});
}

it("preserves popover beforetoggle cancellation, toggle events, and native no-ops", async () => {
	document.body.innerHTML = '<div id="container" popover>Popover</div>';
	const popover = element("container", HTMLDivElement);
	const show = action(fixture.show_popover);
	const hide = action(fixture.hide_popover);
	const states: string[] = [];
	popover.addEventListener("toggle", (event) => states.push(event.newState));
	popover.addEventListener("beforetoggle", (event) => event.preventDefault(), {
		once: true,
	});
	expect(show().unwrap().dehydrate()).toBe(false);
	expect(popover.matches(":popover-open")).toBe(false);
	expect(show().unwrap().dehydrate()).toBe(true);
	expect(show().unwrap().dehydrate()).toBe(true);
	await expect.poll(() => states).toEqual(["open"]);
	expect(hide().unwrap().dehydrate()).toBe(false);
	expect(hide().unwrap().dehydrate()).toBe(false);
	await expect.poll(() => states).toEqual(["open", "closed"]);
});

it("interoperates with declarative popover buttons and native auto-popover grouping", () => {
	document.body.innerHTML =
		'<button id="toggle" popovertarget="container">Toggle</button><div id="container" popover>One</div><div id="other" popover>Two</div>';
	const first = element("container", HTMLDivElement);
	const second = new ElementRef("other", "html").resolve().unwrap();
	element("toggle", HTMLButtonElement).click();
	expect(first.matches(":popover-open")).toBe(true);
	action(fixture.hide_popover)().unwrap();
	element("toggle", HTMLButtonElement).click();
	expect(first.matches(":popover-open")).toBe(true);
	expect(second.show_popover().unwrap().dehydrate()).toBe(true);
	expect(first.matches(":popover-open")).toBe(false);
	action(fixture.show_popover)().unwrap();
	expect(second.node.matches(":popover-open")).toBe(false);
});

it("reports missing popover attributes and non-modal dialogs as invalid native state", () => {
	document.body.innerHTML =
		'<div id="container"></div><dialog id="dialog" open></dialog>';
	expect(
		action(fixture.show_popover)().unwrap_err().is_invalid_state().dehydrate(),
	).toBe(true);
	expect(
		action(fixture.hide_popover)().unwrap_err().is_invalid_state().dehydrate(),
	).toBe(true);
	expect(
		action(fixture.show_modal)().unwrap_err().is_invalid_state().dehydrate(),
	).toBe(true);
	const dialog = element("dialog", HTMLDialogElement);
	action<void>(fixture.close)().unwrap();
	dialog.setAttribute("popover", "manual");
	dialog.showPopover();
	expect(
		action(fixture.show_modal)().unwrap_err().is_invalid_state().dehydrate(),
	).toBe(true);
});

it("uses native modal focus, inertness, close events, return values, and focus restoration", async () => {
	document.body.innerHTML =
		'<button id="outside">Open</button><dialog id="dialog"><input id="inside" autofocus></dialog>';
	const outside = element("outside", HTMLButtonElement);
	const dialog = element("dialog", HTMLDialogElement);
	const inside = element("inside", HTMLInputElement);
	let closes = 0;
	let cancels = 0;
	dialog.addEventListener("close", () => {
		closes++;
	});
	dialog.addEventListener("cancel", () => {
		cancels++;
	});
	outside.focus();
	expect(action(fixture.show_modal)().unwrap().dehydrate()).toBe(true);
	expect(dialog.matches(":modal")).toBe(true);
	expect(document.activeElement).toBe(inside);
	// WebKit applies modal inertness at the next rendering opportunity.
	await new Promise((resolve) => requestAnimationFrame(resolve));
	expect(
		new ElementRef("outside", "html")
			.resolve()
			.unwrap()
			.focus(new Bool(true))
			.unwrap()
			.dehydrate(),
	).toBe(false);
	expect(document.activeElement).toBe(inside);
	expect(action(fixture.show_modal)().unwrap().dehydrate()).toBe(true);
	action<void>(fixture.close)().unwrap();
	expect(dialog.open).toBe(false);
	expect(dialog.returnValue).toBe("accepted");
	expect(document.activeElement).toBe(outside);
	await expect.poll(() => closes).toBe(1);
	expect(cancels).toBe(0);
	new ElementRef("dialog", "dialog")
		.resolve()
		.unwrap()
		.close(new Str("ignored"))
		.unwrap();
	expect(dialog.returnValue).toBe("accepted");
});

it("honors native Escape cancellation and closes on a subsequent uncanceled Escape", async () => {
	document.body.innerHTML =
		'<button id="outside">Open</button><dialog id="dialog"><button autofocus>Inside</button></dialog>';
	const dialog = element("dialog", HTMLDialogElement);
	element("outside", HTMLButtonElement).focus();
	action(fixture.show_modal)().unwrap();
	let cancels = 0;
	dialog.addEventListener("cancel", (event) => {
		cancels++;
		if (cancels === 1) event.preventDefault();
	});
	await userEvent.keyboard("{Escape}");
	await expect.poll(() => cancels).toBe(1);
	expect(dialog.open).toBe(true);
	await userEvent.keyboard("{Escape}");
	await expect.poll(() => cancels).toBe(2);
	expect(dialog.open).toBe(false);
	expect(document.activeElement).toBe(element("outside", HTMLButtonElement));
});

it("rejects every action on detached snapshots and resolves replacements afresh", () => {
	document.body.innerHTML =
		'<input id="field"><div id="container" popover></div><dialog id="dialog"></dialog>';
	const reference = new ElementRef("field", "input");
	const input = reference.resolve().unwrap();
	const html = new ElementRef("container", "html").resolve().unwrap();
	const dialog = new ElementRef("dialog", "dialog").resolve().unwrap();
	input.node.remove();
	html.node.remove();
	dialog.node.remove();
	for (const result of [
		input.focus(new Bool(true)),
		input.scroll_into_view(instant()),
		input.contains(new EventTarget(null)),
		input.set_custom_validity(new Str("Invalid")),
		input.report_validity(),
		input.form_target(),
		html.show_popover(),
		html.hide_popover(),
		dialog.show_modal(),
		dialog.close(new Str("")),
	]) {
		expect(result.unwrap_err().is_disconnected().dehydrate()).toBe(true);
	}
	const formError = compile<(element: ElementHandle) => Bool>(
		fixture.form_error,
		"form error",
	)(runtime.context);
	expect(formError(input).dehydrate()).toBe(true);
	expect(reference.resolve().unwrap_err().is_missing().dehydrate()).toBe(true);
	document.body.innerHTML = '<div id="field"></div>';
	expect(reference.resolve().unwrap_err().is_wrong_type().dehydrate()).toBe(
		true,
	);
	document.body.innerHTML = '<input id="field">';
	expect(action(fixture.focus)().unwrap().dehydrate()).toBe(true);
	expect(document.activeElement).not.toBe(input.node);
	expect(
		input.focus(new Bool(true)).unwrap_err().is_disconnected().dehydrate(),
	).toBe(true);
	expect(() => dehydrate(reference.resolve().unwrap())).toThrow();
});

it("reports disconnection when a native beforetoggle listener removes the element", () => {
	document.body.innerHTML = '<div id="container" popover></div>';
	const popover = element("container", HTMLDivElement);
	popover.addEventListener("beforetoggle", () => popover.remove(), {
		once: true,
	});
	expect(
		action(fixture.show_popover)().unwrap_err().is_disconnected().dehydrate(),
	).toBe(true);
});

it("reports unsupported native APIs without falling back to a second behavior", () => {
	document.body.innerHTML =
		'<input id="field"><div id="container" popover></div><dialog id="dialog"></dialog>';
	const input = new ElementRef("field", "input").resolve().unwrap();
	const html = new ElementRef("container", "html").resolve().unwrap();
	const dialog = new ElementRef("dialog", "dialog").resolve().unwrap();
	for (const [node, method, invoke] of [
		[input.node, "focus", () => input.focus(new Bool(true))],
		[html.node, "scrollIntoView", () => html.scroll_into_view(instant())],
		[
			input.node,
			"setCustomValidity",
			() => input.set_custom_validity(new Str("")),
		],
		[input.node, "reportValidity", () => input.report_validity()],
		[html.node, "showPopover", () => html.show_popover()],
		[html.node, "hidePopover", () => html.hide_popover()],
		[dialog.node, "showModal", () => dialog.show_modal()],
		[dialog.node, "close", () => dialog.close(new Str(""))],
	] as const) {
		Object.defineProperty(node, method, { value: undefined });
		expect(invoke().unwrap_err().is_unsupported().dehydrate()).toBe(true);
	}
});

it("keeps two keyed instances isolated across runtime reorder and removal", () => {
	document.body.innerHTML = fixture.keyed;
	runtime.start(document);
	const inputs = Array.from(document.querySelectorAll("input"));
	expect(new Set(inputs.map((input) => input.id)).size).toBe(2);
	const check = () => {
		for (const button of document.querySelectorAll("button")) {
			button.click();
			expect(document.activeElement).toBe(
				document.querySelector(`input[data-key="${button.dataset.key}"]`),
			);
		}
	};
	check();
	runtime.page.replaceContent(
		`<html><body>${fixture.reordered}</body></html>`,
		newRender(),
	);
	expect(Array.from(document.querySelectorAll("input"))).toEqual(
		[...inputs].reverse(),
	);
	check();
	const removed = inputs[0];
	if (!removed) throw new Error("Missing first input");
	const held = new ElementRef(removed.id, "input").resolve().unwrap();
	removed.remove();
	expect(
		held.focus(new Bool(true)).unwrap_err().is_disconnected().dehydrate(),
	).toBe(true);
	const remaining = inputs[1];
	if (!remaining) throw new Error("Missing second input");
	new ElementRef(remaining.id, "input")
		.resolve()
		.unwrap()
		.focus(new Bool(true))
		.unwrap();
	expect(document.activeElement).toBe(remaining);
});

it("keeps block and inline scroll alignment independent", () => {
	document.body.innerHTML =
		'<div id="scroller" style="width:200px;height:200px;overflow:scroll;position:relative"><div style="width:1600px;height:1600px"><div id="container" style="position:absolute;top:800px;left:700px;width:40px;height:40px"></div></div></div>';
	const scroller = element("scroller", HTMLDivElement);
	const target = element("container", HTMLDivElement);
	action<void>(fixture.scroll.mixed)().unwrap();
	const outer = scroller.getBoundingClientRect();
	const inner = target.getBoundingClientRect();
	expect(inner.top - outer.top).toBeCloseTo(
		scroller.clientHeight - inner.height,
		0,
	);
	expect(inner.left - outer.left).toBeCloseTo(
		(scroller.clientWidth - inner.width) / 2,
		0,
	);
});

it("allows native modal opening cancellation", () => {
	document.body.innerHTML = '<dialog id="dialog"><input autofocus></dialog>';
	const dialog = element("dialog", HTMLDialogElement);
	dialog.addEventListener("beforetoggle", (event) => event.preventDefault(), {
		once: true,
	});
	expect(action(fixture.show_modal)().unwrap().dehydrate()).toBe(false);
	expect(dialog.open).toBe(false);
	expect(action(fixture.show_modal)().unwrap().dehydrate()).toBe(true);
});

it("keeps manual popovers independent and lets Escape dismiss an auto popover", async () => {
	document.body.innerHTML =
		'<button id="outside">Open</button><div id="container" popover="manual">One</div><div id="other" popover="manual">Two</div>';
	const first = element("container", HTMLDivElement);
	const second = new ElementRef("other", "html").resolve().unwrap();
	action(fixture.show_popover)().unwrap();
	second.show_popover().unwrap();
	expect(first.matches(":popover-open")).toBe(true);
	expect(second.node.matches(":popover-open")).toBe(true);
	action(fixture.hide_popover)().unwrap();
	expect(second.node.matches(":popover-open")).toBe(true);
	first.popover = "auto";
	element("outside", HTMLButtonElement).focus();
	action(fixture.show_popover)().unwrap();
	await userEvent.keyboard("{Escape}");
	await expect.poll(() => first.matches(":popover-open")).toBe(false);
	expect(second.node.matches(":popover-open")).toBe(true);
});

it("reports an invalid input through the native default validation behavior", async () => {
	document.body.innerHTML = '<input id="field">';
	const input = element("field", HTMLInputElement);
	let invalid = 0;
	input.addEventListener("invalid", () => {
		invalid++;
	});
	action<void>(fixture.input.set)().unwrap();
	expect(action(fixture.input.report)().unwrap().dehydrate()).toBe(false);
	expect(invalid).toBe(1);
	await expect.poll(() => document.activeElement).toBe(input);
	action<void>(fixture.input.clear)().unwrap();
	expect(action(fixture.input.report)().unwrap().dehydrate()).toBe(true);
});

it("propagates unexpected exceptions from native boundaries", () => {
	document.body.innerHTML = '<input id="field">';
	const input = element("field", HTMLInputElement);
	const failure = new TypeError("unexpected failure");
	Object.defineProperty(input, "focus", {
		value: () => {
			input.remove();
			throw failure;
		},
	});
	expect(action(fixture.focus)).toThrow(failure);
});

it("instant scrolling overrides CSS smooth behavior", () => {
	document.body.innerHTML =
		'<div id="scroller" style="width:200px;height:200px;overflow:auto;scroll-behavior:smooth"><div style="height:600px"></div><div id="container" style="height:30px"></div><div style="height:400px"></div></div>';
	action<void>(fixture.scroll.start)().unwrap();
	expect(element("scroller", HTMLDivElement).scrollTop).toBe(600);
});
