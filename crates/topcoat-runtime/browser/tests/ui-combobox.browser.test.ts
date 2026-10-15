import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { flushEffects } from "../src/reactivity";
import { newRender } from "../src/render/frames";
import { ShardUnit } from "../src/render/shard";
import { Runtime } from "../src/runtime";
import type { Scope } from "../src/scope";
import fixture from "./ui-combobox.json";

let runtime: Runtime;
let errors: unknown[];
let requests: { resolve: (response: Response) => void; body: string }[];

beforeEach(() => {
	errors = [];
	requests = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(
			(_url: string, init: RequestInit) =>
				new Promise<Response>((resolve) => {
					if (typeof init.body !== "string")
						throw new Error("Expected a shard request body");
					requests.push({ resolve, body: init.body });
				}),
		),
	);
});

afterEach(async () => {
	runtime?.navigation.dispose();
	runtime?.page.dispose();
	flushEffects();
	document.body.innerHTML = "";
	vi.unstubAllGlobals();
	await userEvent.cleanup();
	expect(errors).toEqual([]);
});

function mount(html = fixture.initial) {
	document.body.innerHTML = html;
	runtime = new Runtime();
	vi.spyOn(runtime, "reportError").mockImplementation((error) =>
		errors.push(error),
	);
	runtime.start(document);
	flushEffects();
	const input = document.querySelector<HTMLInputElement>('[role="combobox"]');
	const form = document.querySelector<HTMLFormElement>("#owner");
	const popup = document.querySelector<HTMLElement>('[role="listbox"]');
	if (!input || !form || !popup) throw new Error("Missing combobox shell");
	return { input, form, popup };
}

function active(input: HTMLInputElement) {
	const id = input.getAttribute("aria-activedescendant");
	return id ? document.getElementById(id) : null;
}

function results(scope: Scope = runtime.page.contentScope): ShardUnit {
	if (scope.unit instanceof ShardUnit) return scope.unit;
	for (const child of scope.children) {
		try {
			return results(child);
		} catch {
			/* Other component scopes have no shard. */
		}
	}
	throw new Error("Missing results shard");
}

function accept(html: string) {
	results().replaceContent(html, newRender());
	flushEffects();
}

function edit(input: HTMLInputElement, text: string, composing = false) {
	input.value = text;
	input.dispatchEvent(
		new InputEvent("input", { bubbles: true, isComposing: composing }),
	);
	flushEffects();
}

async function reply(index: number, html: string) {
	await expect.poll(() => requests.length).toBeGreaterThan(index);
	requests[index]?.resolve(
		new Response(`${JSON.stringify({ t: "snapshot", html })}\n`, {
			headers: { "Content-Type": "application/x-ndjson" },
		}),
	);
}

// Only for native default-action completion, never server-render completion.
const nativeTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

it("keeps native focus and skips disabled options, stopping at the ends", async () => {
	const { input, form, popup } = mount();
	input.focus();
	await userEvent.keyboard("{ArrowDown}");
	expect(popup.matches(":popover-open")).toBe(true);
	expect(active(input)?.textContent).toBe("Alpha");
	await userEvent.keyboard("{ArrowDown}");
	expect(active(input)?.textContent).toBe("Gamma");
	await userEvent.keyboard("{ArrowUp}{ArrowUp}");
	expect(active(input)?.textContent).toBe("Alpha");
	expect(document.activeElement).toBe(input);
	await userEvent.keyboard("{ArrowDown}{Enter}");
	expect(input.value).toBe("Gamma");
	expect(new FormData(form).getAll("region")).toEqual(["gamma"]);
	expect(input.validity.valid).toBe(true);
	expect(input.getAttribute("aria-expanded")).toBe("false");
	expect(input.hasAttribute("aria-activedescendant")).toBe(false);
});

it("requires an explicit selection and clears an optional draft", async () => {
	const { input, form } = mount(fixture.empty);
	expect(input.validity.valid).toBe(true);
	await userEvent.fill(page.getByRole("combobox"), "Alpha");
	expect(input.validity.customError).toBe(true);
	expect(new FormData(form).get("region")).toBe("");
	await userEvent.keyboard("{Enter}");
	expect(input.value).toBe("Alpha");
	expect(new FormData(form).get("region")).toBe("");
	await userEvent.fill(page.getByRole("combobox"), "");
	expect(input.validity.valid).toBe(true);
});

it("rejects stale A-B-A responses and applies pending navigation only to the current result", async () => {
	const { input, popup } = mount();
	input.focus();
	edit(input, "ga");
	await expect.poll(() => requests.length).toBe(1);
	await userEvent.keyboard("{ArrowDown}");
	expect(active(input)).toBeNull();
	edit(input, "zz");
	await expect.poll(() => requests.length).toBe(2);
	edit(input, "ga");
	await expect.poll(() => requests.length).toBe(3);
	await userEvent.keyboard("{ArrowUp}");
	await reply(0, fixture.search.ga1);
	await reply(1, fixture.search.zz2);
	expect(active(input)).toBeNull();
	expect(input.value).toBe("ga");
	await reply(2, fixture.search.ga3);
	await expect.poll(() => active(input)?.textContent).toBe("Gamma");
	expect(document.activeElement).toBe(input);
	expect(
		popup.querySelector('[role="option"]')?.getClientRects().length,
	).toBeGreaterThan(0);
});

for (const dismissal of ["Escape", "Tab", "outside"] as const) {
	it(`does not reopen or steal focus after ${dismissal} while search is pending`, async () => {
		const { input, popup } = mount();
		input.focus();
		edit(input, "ga");
		await userEvent.keyboard("{ArrowDown}");
		if (dismissal === "outside")
			await userEvent.click(page.getByRole("button", { name: "Outside" }));
		else await userEvent.keyboard(`{${dismissal}}`);
		const focused = document.activeElement;
		await reply(0, fixture.search.ga1);
		expect(input.value).toBe("ga");
		expect(active(input)).toBeNull();
		expect(popup.matches(":popover-open")).toBe(false);
		expect(document.activeElement).toBe(focused);
	});
}

it("keeps text editing keys and modifiers native", async () => {
	const { input } = mount();
	input.focus();
	input.setSelectionRange(2, 2);
	for (const [key, ctrlKey] of [
		["Home", false],
		["End", false],
		["ArrowLeft", false],
		["ArrowRight", false],
		["ArrowDown", true],
	] as const) {
		const event = new KeyboardEvent("keydown", {
			key,
			ctrlKey,
			bubbles: true,
			cancelable: true,
		});
		expect(input.dispatchEvent(event)).toBe(true);
	}
	expect(input.getAttribute("aria-expanded")).toBe("false");
	await userEvent.keyboard("{ArrowDown}{Escape}");
	expect(input.value).toBe("Alpha");
});

it("commits a pointer choice without moving focus into the list", async () => {
	const { input, form } = mount();
	await userEvent.click(page.getByRole("combobox"));
	await userEvent.click(page.getByRole("option", { name: "Gamma" }));
	expect(document.activeElement).toBe(input);
	expect(new FormData(form).get("region")).toBe("gamma");
});

it("honors canceled native opening and keeps closed Enter submission native", async () => {
	const { input, form, popup } = mount();
	let submits = 0;
	form.addEventListener("submit", (event) => {
		event.preventDefault();
		submits++;
	});
	input.focus();
	await userEvent.keyboard("{Enter}");
	expect(submits).toBe(1);
	popup.addEventListener("beforetoggle", (event) => event.preventDefault(), {
		once: true,
	});
	await userEvent.keyboard("{ArrowDown}");
	expect(popup.matches(":popover-open")).toBe(false);
	expect(input.getAttribute("aria-expanded")).toBe("false");
	await userEvent.keyboard("{ArrowUp}");
	expect(active(input)?.textContent).toBe("Alpha");
	const last = active(input);
	await userEvent.keyboard("{ArrowDown}{ArrowDown}");
	expect(active(input)).toBe(last);
	expect(popup.querySelectorAll('[aria-selected="true"]')).toHaveLength(1);
	await userEvent.keyboard("{Enter}");
	expect(submits).toBe(1);
	expect(new FormData(form).get("region")).toBe("duplicate");
});

it("leaves stale results unusable after transport failure and accepts a retry", async () => {
	const { input } = mount();
	input.focus();
	edit(input, "ga");
	await expect.poll(() => requests.length).toBe(1);
	requests[0]?.resolve(new Response("unavailable", { status: 503 }));
	await expect.poll(() => errors.length).toBe(1);
	expect(String(errors.shift())).toContain("503");
	await userEvent.keyboard("{ArrowDown}{Enter}");
	expect(active(input)).toBeNull();
	expect(input.value).toBe("ga");
	edit(input, "zz");
	await reply(1, fixture.search.zz2);
	await expect
		.element(page.getByRole("status").filter({ hasText: "No matches." }))
		.toBeVisible();
	expect(active(input)).toBeNull();
});

for (const kind of ["button", "method"] as const) {
	for (const cancellation of ["none", "form", "document"] as const) {
		it(`handles ${kind} reset with later ${cancellation} cancellation`, async () => {
			const { input, form } = mount();
			input.focus();
			await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
			expect(input.value).toBe("Gamma");
			const cancel = (event: Event) => event.preventDefault();
			const target = cancellation === "form" ? form : document;
			if (cancellation !== "none")
				target.addEventListener("reset", cancel, { once: true });
			if (kind === "button")
				await userEvent.click(
					page.getByRole("button", { name: "Reset", exact: true }),
				);
			else form.reset();
			await nativeTask();
			flushEffects();
			expect(input.value).toBe(cancellation === "none" ? "Alpha" : "Gamma");
			expect(new FormData(form).get("region")).toBe(
				cancellation === "none" ? "alpha" : "gamma",
			);
			expect(input.validity.valid).toBe(true);
		});
	}
}

it("invalidates pending work on reset and ignores a reset superseded by newer input", async () => {
	const { input, form, popup } = mount();
	input.focus();
	edit(input, "ga");
	await expect.poll(() => requests.length).toBe(1);
	form.reset();
	await nativeTask();
	flushEffects();
	expect(input.value).toBe("Alpha");
	await reply(0, fixture.search.ga1);
	expect(input.value).toBe("Alpha");
	expect(popup.matches(":popover-open")).toBe(false);
	form.reset();
	edit(input, "new draft");
	await nativeTask();
	flushEffects();
	expect(input.value).toBe("new draft");
});

it("uses the unnamed visible input for required and custom validity", async () => {
	const { input, form } = mount(fixture.required);
	let submits = 0;
	form.addEventListener("submit", (event) => {
		event.preventDefault();
		submits++;
	});
	form.requestSubmit();
	flushEffects();
	expect(submits).toBe(0);
	expect(input.validity.valueMissing).toBe(true);
	expect(input.getAttribute("aria-invalid")).toBe("true");
	input.focus();
	await userEvent.keyboard("{ArrowDown}{Enter}");
	form.requestSubmit();
	expect(submits).toBe(1);
	expect(input.name).toBe("");
	expect(new FormData(form).getAll("region")).toEqual(["alpha"]);
});

it("excludes an explicitly disabled control from validation and submission", () => {
	const { input, form } = mount(fixture.disabled);
	expect(input.disabled).toBe(true);
	expect(input.willValidate).toBe(false);
	expect(new FormData(form).has("region")).toBe(false);
});

for (const name of ["disabled_default", "missing_default"] as const) {
	it(`normalizes a ${name} to an empty successful control`, () => {
		const { input, form } = mount(fixture[name]);
		expect(input.value).toBe("");
		expect(new FormData(form).get("region")).toBe("");
	});
}

it("isolates multiple controls and keeps their nodes through keyed reordering", async () => {
	document.body.innerHTML = fixture.multiple;
	runtime = new Runtime();
	vi.spyOn(runtime, "reportError").mockImplementation((error) =>
		errors.push(error),
	);
	runtime.start(document);
	flushEffects();
	const inputs = [
		...document.querySelectorAll<HTMLInputElement>('[role="combobox"]'),
	];
	const first = inputs[0];
	const second = inputs[1];
	if (!first || !second) throw new Error("Missing controls");
	expect(first.id).not.toBe(second.id);
	first.focus();
	await userEvent.keyboard("{ArrowDown}{Enter}");
	expect(first.value).toBe("Alpha");
	expect(second.value).toBe("");
	runtime.page.replaceContent(
		`<html><body>${fixture.reordered}</body></html>`,
		newRender(),
	);
	flushEffects();
	expect([...document.querySelectorAll('[role="combobox"]')]).toEqual([
		second,
		first,
	]);
	expect(first.value).toBe("Alpha");
	expect(second.value).toBe("");
});

it("respects native fieldset disabling when an old option remains open", async () => {
	const { input, form } = mount();
	input.focus();
	await userEvent.keyboard("{ArrowDown}");
	const fieldset = document.querySelector<HTMLFieldSetElement>("#fieldset");
	if (!fieldset) throw new Error("Missing fieldset");
	const option = [
		...document.querySelectorAll<HTMLElement>('[role="option"]'),
	].find((node) => node.textContent === "Gamma");
	if (!option) throw new Error("Missing held option");
	fieldset.disabled = true;
	option.click();
	flushEffects();
	expect(new FormData(form).has("region")).toBe(false);
	expect(input.value).toBe("Alpha");
	expect(input.willValidate).toBe(false);
});

for (const order of ["end-input-enter", "enter-end-input"] as const) {
	it(`publishes only final composition text and guards completion Enter (${order})`, async () => {
		const { input, form } = mount();
		let submits = 0;
		form.addEventListener("submit", (event) => {
			event.preventDefault();
			submits++;
		});
		input.focus();
		input.dispatchEvent(
			new CompositionEvent("compositionstart", { bubbles: true }),
		);
		edit(input, "g", true);
		await nativeTask();
		expect(requests).toHaveLength(0);
		const composingEnter = new KeyboardEvent("keydown", {
			key: "Enter",
			isComposing: true,
			bubbles: true,
			cancelable: true,
		});
		if (order === "enter-end-input")
			expect(input.dispatchEvent(composingEnter)).toBe(true);
		form.requestSubmit();
		expect(submits).toBe(0);
		input.value = "ga";
		input.dispatchEvent(
			new CompositionEvent("compositionend", { bubbles: true }),
		);
		edit(input, "ga");
		if (order === "end-input-enter") {
			const enter = new KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			});
			expect(input.dispatchEvent(enter)).toBe(false);
		}
		form.requestSubmit();
		expect(submits).toBe(0);
		await expect.poll(() => requests.length).toBe(1);
		await reply(0, fixture.search.ga1);
		expect(input.value).toBe("ga");
		expect(new FormData(form).get("region")).toBe("");
	});
}

for (const version of ["removed", "disabled"] as const) {
	it(`clears a ${version} selection and does not restore its stale default`, async () => {
		const { input, form } = mount();
		accept(fixture.catalog[version]);
		expect(input.value).toBe("");
		expect(new FormData(form).get("region")).toBe("");
		form.reset();
		await nativeTask();
		flushEffects();
		expect(input.value).toBe("");
	});
}

it("reconciles successive live emissions and retained keyed active identity", async () => {
	const { input } = mount();
	input.focus();
	await userEvent.keyboard("{ArrowDown}{ArrowDown}");
	const old = active(input);
	accept(fixture.catalog.reordered);
	expect(active(input)).toBe(old);
	expect(active(input)?.textContent).toBe("Gamma");
	const unit = results();
	const render = newRender();
	unit.replaceContent(
		`<!--::topcoat::region::start(ab)-->${fixture.catalog.renamed}<!--::topcoat::region::end(ab)-->`,
		render,
	);
	flushEffects();
	expect(input.value).toBe("New Alpha");
	unit.applySwap("ab", fixture.catalog.disabled, render);
	flushEffects();
	expect(input.value).toBe("");
	expect(document.activeElement).toBe(input);
});

it("disposes native listeners and queued reset work with the owner", async () => {
	const { input, form } = mount();
	input.focus();
	edit(input, "ga");
	form.reset();
	runtime.page.dispose();
	await nativeTask();
	expect(input.value).toBe("ga");
	form.reset();
	await nativeTask();
	expect(errors).toEqual([]);
});
