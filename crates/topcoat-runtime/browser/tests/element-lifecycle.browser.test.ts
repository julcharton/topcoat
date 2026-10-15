import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
	DEV_RUNTIME_EVENT,
	type DevRuntimeDetail,
} from "../../../topcoat-core/browser/dev";
import { morph } from "../../../topcoat-core/browser/morph";
import { flushEffects } from "../src/reactivity";
import { newRender } from "../src/render/frames";
import { Runtime } from "../src/runtime";
import fixtures from "./element-lifecycle.json";

const fixture = fixtures.initial;

let runtime: Runtime;
let originalHead: string;
let errors: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
	await page.viewport(800, 600);
});

beforeEach(() => {
	originalHead = document.head.innerHTML;
	document.body.innerHTML = `<!--::topcoat::region::start(ab)-->${fixture}<!--::topcoat::region::end(ab)-->`;
	runtime = new Runtime();
	errors = vi.spyOn(runtime, "reportError");
});

afterEach(async () => {
	runtime.navigation.dispose();
	runtime.page.dispose();
	flushEffects();
	expect(errors).not.toHaveBeenCalled();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	document.documentElement.removeAttribute("data-topcoat-element-lifecycle");
	document.head.innerHTML = originalHead;
	document.body.innerHTML = "";
	await userEvent.cleanup();
});

function element<T extends HTMLElement>(id: string, type: { new (): T }): T {
	const node = document.getElementById(id);
	if (!(node instanceof type)) throw new Error(`Missing ${id}`);
	return node;
}

const dialog = (id = "modal") => element(id, HTMLDialogElement);
const button = (id: string) => element(id, HTMLButtonElement);
const input = (id: string) => element(id, HTMLInputElement);
const output = (id: string) => document.getElementById(id)?.textContent;

function start(): void {
	runtime.start(document);
	flushEffects();
}

function open(id = "modal"): void {
	const trigger = button(id === "modal" ? "trigger" : `${id}-trigger`);
	trigger.focus();
	trigger.click();
	flushEffects();
	expect(dialog(id).matches(":modal")).toBe(true);
}

const frame = () =>
	new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const settled = async () => {
	await frame();
	await frame();
	flushEffects();
};

it("keeps a native opening intact when its toggle updates the signal", async () => {
	start();
	input("close-updates-open").click();
	button("trigger").focus();
	const node = dialog();
	const show = vi.spyOn(node, "showModal");
	node.showModal();
	input("modal-auto").focus();
	await settled();
	expect(output("closes")).toBe("0");
	expect(show).toHaveBeenCalledTimes(1);
	expect(node.matches(":modal")).toBe(true);
	expect(output("state")).toBe("true");
	expect(document.activeElement).toBe(input("modal-auto"));
	node.close();
	await expect.poll(() => output("closes")).toBe("1");
	expect(output("state")).toBe("false");
	expect(document.activeElement).toBe(button("trigger"));
});

it("leaves an already open session and focus unchanged on repeated true", async () => {
	start();
	open();
	await settled();
	input("modal-auto").focus();
	const show = vi.spyOn(dialog(), "showModal");
	button("trigger").click();
	flushEffects();
	await settled();
	expect(output("closes")).toBe("0");
	expect(show).not.toHaveBeenCalled();
	expect(dialog().matches(":modal")).toBe(true);
	expect(document.activeElement).toBe(input("modal-auto"));
});

it("preserves an open session across reuse with a caller close that clears the signal", async () => {
	start();
	input("close-updates-open").click();
	open();
	await settled();
	const node = dialog();
	input("modal-auto").focus();
	runtime.page.applySwap("ab", fixture, null);
	flushEffects();
	expect(dialog()).toBe(node);
	await settled();
	expect(output("closes")).toBe("0");
	expect(node.matches(":modal")).toBe(true);
	expect(output("state")).toBe("true");
	expect(document.activeElement).toBe(input("modal-auto"));
	await userEvent.keyboard("{Escape}");
	await expect.poll(() => output("closes")).toBe("1");
	expect(output("state")).toBe("false");
	expect(document.activeElement).toBe(button("trigger"));
});

it("retains a genuine native dismissal when morph precedes its queued events", async () => {
	start();
	open();
	await settled();
	const node = dialog();
	node.close("before-morph");
	runtime.page.applySwap("ab", fixture, null);
	flushEffects();
	expect(dialog()).toBe(node);
	expect(node.open).toBe(false);
	await settled();
	expect(output("state")).toBe("false");
	expect(output("closes")).toBe("1");
	expect(node.returnValue).toBe("before-morph");
	expect(document.activeElement).toBe(button("trigger"));
});

it("preserves both native return-focus destinations through nested reuse", async () => {
	start();
	open();
	button("child-trigger").focus();
	await userEvent.keyboard("{Enter}");
	await expect.poll(() => dialog("child").matches(":modal")).toBe(true);
	await settled();
	const parent = dialog();
	const child = dialog("child");
	const parentOpener = button("trigger");
	const childOpener = button("child-trigger");
	input("child-target").focus();
	runtime.page.applySwap("ab", fixture, null);
	flushEffects();
	await settled();
	expect(dialog()).toBe(parent);
	expect(dialog("child")).toBe(child);
	expect(button("trigger")).toBe(parentOpener);
	expect(button("child-trigger")).toBe(childOpener);
	expect(document.querySelectorAll(":modal")).toHaveLength(2);
	expect.soft(document.activeElement).toBe(input("child-target"));
	await userEvent.keyboard("{Escape}");
	await expect.poll(() => output("child-state")).toBe("false");
	expect.soft(document.activeElement).toBe(childOpener);
	await userEvent.keyboard("{Escape}");
	await expect.poll(() => output("state")).toBe("false");
	expect(document.activeElement).toBe(parentOpener);
});

it("uses a new controlling signal and focus prop without retaining old captures", async () => {
	start();
	const node = dialog();
	runtime.page.applySwap("ab", fixtures.alternate, null);
	flushEffects();
	expect(dialog()).toBe(node);
	button("first").click();
	flushEffects();
	expect(node.open).toBe(false);
	button("second").focus();
	button("second").click();
	flushEffects();
	expect(node.matches(":modal")).toBe(true);
	expect(document.activeElement).toBe(input("modal-auto"));
	node.close();
	await settled();
	expect(output("first-state")).toBe("true");
	expect(output("second-state")).toBe("false");
});

it.each([
	false,
	true,
])("replaces native sessions for a connection-breaking move (ancestor: %s)", async (ancestor) => {
	const content = ancestor ? `<div id="moving">${fixture}</div>` : fixture;
	const initial = `<div id="destination"></div><div id="source">${content}</div>`;
	document.body.innerHTML = `<!--::topcoat::region::start(ab)-->${initial}<!--::topcoat::region::end(ab)-->`;
	start();
	open();
	await settled();
	const old = dialog();
	const close = vi.spyOn(old, "close");
	// Exercise the fallback even in engines that support state-preserving moves.
	const destination = element("destination", HTMLDivElement);
	Object.defineProperty(destination, "moveBefore", {
		value: undefined,
		configurable: true,
	});
	try {
		const next = `<div id="destination">${content}</div><div id="source"></div>`;
		runtime.page.applySwap("ab", next, null);
		flushEffects();
		expect(dialog()).not.toBe(old);
		expect(close).toHaveBeenCalledTimes(1);
		expect(old.isConnected).toBe(false);
		await settled();
		expect(output("closes")).toBe("0");
	} finally {
		Reflect.deleteProperty(destination, "moveBefore");
	}
});

it("passes lifecycle ownership through a dev-client morph", async () => {
	start();
	open();
	await settled();
	const node = dialog();
	runtime.page.listenForDevRefresh();
	const detail: DevRuntimeDetail = {};
	window.dispatchEvent(new CustomEvent(DEV_RUNTIME_EVENT, { detail }));
	detail.runtime?.replace((options) => {
		const next = new DOMParser().parseFromString(
			`<html><head></head><body>${fixture}</body></html>`,
			"text/html",
		);
		morph(document.body, null, null, next.body.childNodes, options);
	});
	flushEffects();
	await settled();
	expect(dialog()).toBe(node);
	expect(node.matches(":modal")).toBe(true);
	expect(output("closes")).toBe("0");
});

it("finalizes nested native dialogs once, deepest first while connected", async () => {
	start();
	open();
	open("child");
	await settled();
	const calls: string[] = [];
	for (const id of ["modal", "child"]) {
		const node = dialog(id);
		const close = node.close.bind(node);
		vi.spyOn(node, "close").mockImplementation((value) => {
			expect(node.isConnected).toBe(true);
			calls.push(id);
			close(value);
		});
	}
	runtime.page.applySwap("ab", "", null);
	runtime.page.dispose();
	await settled();
	expect(calls).toEqual(["child", "modal"]);
});

it("isolates queued teardown events from the fresh native session after navigation commit", async () => {
	start();
	input("close-updates-open").click();
	open();
	await settled();
	const old = dialog();
	const close = vi.spyOn(old, "close");
	runtime.page.replaceDocument(
		new DOMParser().parseFromString(
			`<html><head>${originalHead}</head><body>${fixture}</body></html>`,
			"text/html",
		),
		newRender(),
	);
	flushEffects();
	expect(close).toHaveBeenCalledTimes(1);
	expect(dialog()).not.toBe(old);
	await settled();
	expect(dialog().matches(":modal")).toBe(true);
	expect(output("state")).toBe("true");
	expect(output("closes")).toBe("0");
});

it("applies navigation lifetime boundaries to the document element too", () => {
	const finalized: Element[] = [];
	vi.stubGlobal("rootConfigure", (scope: { element: Element }) => () => {
		expect(scope.element.isConnected).toBe(true);
		finalized.push(scope.element);
	});
	vi.stubGlobal("rootReconcile", () => {});
	const source = JSON.stringify({
		configure: "rootConfigure",
		reconcile: "rootReconcile",
		attributes: [],
	});
	const old = document.documentElement;
	old.setAttribute("data-topcoat-element-lifecycle", source);
	start();
	const next = new DOMParser().parseFromString(
		`<html><head>${originalHead}</head><body>${fixture}</body></html>`,
		"text/html",
	);
	next.documentElement.setAttribute("data-topcoat-element-lifecycle", source);
	runtime.page.replaceDocument(next, newRender());
	flushEffects();
	expect(finalized).toEqual([old]);
	expect(document.documentElement).not.toBe(old);
	runtime.page.dispose();
	expect(finalized).toEqual([old, document.documentElement]);
});

it("retains native sessions through supported state-preserving moves", async () => {
	const content = `<div id="moving">${fixture}</div>`;
	document.body.innerHTML = `<!--::topcoat::region::start(ab)--><div id="destination"></div><div id="source">${content}</div><!--::topcoat::region::end(ab)-->`;
	start();
	open();
	await settled();
	const node = dialog();
	const destination = element("destination", HTMLDivElement);
	const supportsMove = typeof destination.moveBefore === "function";
	runtime.page.applySwap(
		"ab",
		`<div id="destination">${content}</div><div id="source"></div>`,
		null,
	);
	flushEffects();
	await settled();
	if (supportsMove) expect(dialog()).toBe(node);
	else expect(dialog()).not.toBe(node);
	expect(dialog().matches(":modal")).toBe(true);
	expect(output("closes")).toBe("0");
});
