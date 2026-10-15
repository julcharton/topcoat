// @vitest-environment happy-dom

import { afterEach, expect, it, vi } from "vitest";
import { flushEffects, signal } from "../reactivity";
import { newRender } from "../render/frames";
import { Runtime } from "../runtime";
import { Str } from "../surrogate/string";
import type { EffectContext } from "./effect";

let runtime: Runtime;

function markup(
	configure = "configure",
	reconcile = "reconcile",
	attributes = ["open"],
): string {
	const declaration = JSON.stringify({
		configure,
		reconcile,
		attributes,
	}).replaceAll('"', "&quot;");
	return `<dialog id="owned" data-topcoat-element-lifecycle="${declaration}"></dialog>`;
}

function mount(html = markup()): void {
	document.body.innerHTML = `<!--::topcoat::region::start(ab)-->${html}<!--::topcoat::region::end(ab)-->`;
	runtime = new Runtime();
	runtime.start(document);
	flushEffects();
}

afterEach(() => {
	runtime?.navigation.dispose();
	runtime?.page.dispose();
	flushEffects();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	document.body.innerHTML = "";
});

it("keeps configuration and native ownership across signal reruns, refreshing teardown on reuse", () => {
	const value = signal(0);
	const configured = vi.fn((context: EffectContext) => {
		const version = value();
		context.element.setAttribute("open", "");
		return () => finalized.push(version);
	});
	const finalized: number[] = [];
	const reconciled: number[] = [];
	vi.stubGlobal("configure", configured);
	vi.stubGlobal("reconcile", () => reconciled.push(value()));
	mount();
	const element = document.querySelector("dialog");
	value.set(1);
	flushEffects();
	expect(configured).toHaveBeenCalledTimes(1);
	expect(reconciled).toEqual([0, 1]);
	runtime.page.applySwap("ab", markup(), null);
	flushEffects();
	expect(document.querySelector("dialog")).toBe(element);
	expect(element?.hasAttribute("open")).toBe(true);
	expect(finalized).toEqual([]);
	expect(configured).toHaveBeenCalledTimes(2);
	runtime.page.applySwap("ab", "", null);
	runtime.page.dispose();
	expect(finalized).toEqual([1]);
});

it("finalizes nested resources deepest first while connected", () => {
	const finalized: string[] = [];
	vi.stubGlobal("configure", (context: EffectContext) => () => {
		expect(context.element.isConnected).toBe(true);
		finalized.push(context.element.id);
	});
	vi.stubGlobal("reconcile", () => {});
	mount(
		markup().replace(
			"</dialog>",
			`${markup().replace('id="owned"', 'id="child"')}</dialog>`,
		),
	);
	runtime.page.applySwap("ab", "", null);
	expect(finalized).toEqual(["child", "owned"]);
});

it.each([
	"page",
	"shard",
])("retains a nested native owner through a %s snapshot", (kind) => {
	const final = vi.fn();
	const configure = vi.fn(() => final);
	vi.stubGlobal("configure", configure);
	vi.stubGlobal("reconcile", () => {});
	const html = `<!--::topcoat::shard::start("/shard", "0", [])-->
		<!--::topcoat::region::start(cd)-->${markup()}<!--::topcoat::region::end(cd)-->
		<!--::topcoat::shard::end("0")-->`;
	mount(html);
	const old = document.querySelector("dialog");
	const shard = runtime.page.contentScope.findRegion("cd")?.scope.unit;
	if (!shard) throw new Error("Missing shard");
	if (kind === "page")
		runtime.page.replaceContent(`<body>${html}</body>`, newRender());
	else shard.replaceContent(markup(), newRender());
	flushEffects();
	expect(document.querySelector("dialog")).toBe(old);
	expect(configure).toHaveBeenCalledTimes(2);
	expect(final).not.toHaveBeenCalled();
	runtime.page.dispose();
	expect(final).toHaveBeenCalledTimes(1);
});

it("refreshes captures, signal subscriptions, listeners and finalizers", () => {
	const first = signal(1);
	const second = signal(10);
	const log: string[] = [];
	for (const [name, value] of [
		["first", first],
		["second", second],
	] as const) {
		vi.stubGlobal(`${name}Configure`, (scope: EffectContext) => {
			scope.listen(scope.target(), new Str("click"), () =>
				log.push(`${name} click`),
			);
			scope.on_cleanup(() => log.push(`${name} configuration cleanup`));
			return () => log.push(`${name} final`);
		});
		vi.stubGlobal(`${name}Reconcile`, (scope: EffectContext) => {
			log.push(`${name} ${value()}`);
			scope.on_cleanup(() => log.push(`${name} invocation cleanup`));
		});
	}
	mount(markup("firstConfigure", "firstReconcile"));
	const element = document.querySelector("dialog");
	runtime.page.applySwap(
		"ab",
		markup("secondConfigure", "secondReconcile"),
		null,
	);
	flushEffects();
	expect(document.querySelector("dialog")).toBe(element);
	first.set(2);
	second.set(11);
	flushEffects();
	element?.click();
	runtime.page.dispose();
	expect(log).toEqual([
		"first 1",
		"first invocation cleanup",
		"first configuration cleanup",
		"second 10",
		"second invocation cleanup",
		"second 11",
		"second click",
		"second invocation cleanup",
		"second configuration cleanup",
		"second final",
	]);
});

it("cancels queued configuration, reconciliation and invocation work on replacement", () => {
	const value = signal(0);
	const callbacks = vi.fn();
	const final = vi.fn();
	let context: EffectContext | undefined;
	vi.stubGlobal("configure", (scope: EffectContext) => {
		context = scope;
		return final;
	});
	vi.stubGlobal("reconcile", (scope: EffectContext) => {
		value();
		scope.after_dom(callbacks);
	});
	mount();
	callbacks.mockClear();
	context?.after_dom(callbacks);
	value.set(1);
	runtime.page.applySwap("ab", markup(), null);
	runtime.page.applySwap("ab", "", null);
	flushEffects();
	expect(context?.is_active().dehydrate()).toBe(false);
	expect(callbacks).not.toHaveBeenCalled();
	expect(final).toHaveBeenCalledTimes(1);
});

it.each([
	"declaration",
	"identity",
	"type",
	"claims",
])("ends the lifetime on changed %s and uses a fresh node", (kind) => {
	const final = vi.fn();
	vi.stubGlobal("configure", () => final);
	vi.stubGlobal("reconcile", () => {});
	mount();
	const old = document.querySelector("dialog");
	let next = markup();
	if (kind === "declaration") next = '<dialog id="owned"></dialog>';
	if (kind === "identity") next = next.replace('id="owned"', 'id="other"');
	if (kind === "type") next = next.replaceAll("dialog", "section");
	if (kind === "claims") next = markup("configure", "reconcile", []);
	runtime.page.applySwap("ab", next, null);
	flushEffects();
	expect(document.querySelector("dialog,section")).not.toBe(old);
	expect(final).toHaveBeenCalledTimes(1);
});

it("preserves live absence and presence while ordinary server attributes update", () => {
	vi.stubGlobal("configure", () => () => {});
	vi.stubGlobal("reconcile", () => {});
	mount();
	const element = document.querySelector("dialog");
	runtime.page.applySwap(
		"ab",
		markup().replace("<dialog ", '<dialog open title="new" '),
		null,
	);
	flushEffects();
	expect(element?.hasAttribute("open")).toBe(false);
	expect(element?.getAttribute("title")).toBe("new");
	element?.setAttribute("open", "");
	runtime.page.applySwap("ab", markup(), null);
	flushEffects();
	expect(element?.hasAttribute("open")).toBe(true);
	expect(element?.hasAttribute("title")).toBe(false);
});

it.each([
	"id",
	"data-topcoat-effect",
	"OPEN",
	"bound",
])("rejects invalid live ownership %s", (name) => {
	const configure = vi.fn(() => () => {});
	vi.stubGlobal("configure", configure);
	vi.stubGlobal("reconcile", () => {});
	const report = vi
		.spyOn(Runtime.prototype, "reportError")
		.mockImplementation(() => {});
	const html =
		name === "bound"
			? markup().replace(
					"<dialog ",
					'<dialog data-topcoat-bind:open="cx.hydrate(true)" ',
				)
			: markup("configure", "reconcile", [name]);
	mount(html);
	expect(configure).not.toHaveBeenCalled();
	expect(report).toHaveBeenCalledTimes(1);
});

it.each([
	"recovery",
	"removal",
])("retains the last valid finalizer after configuration failure until %s", (outcome) => {
	const final = vi.fn();
	const recovered = vi.fn();
	const partial = vi.fn();
	vi.stubGlobal("configure", () => final);
	vi.stubGlobal("recover", () => recovered);
	vi.stubGlobal("fail", (scope: EffectContext) => {
		scope.on_cleanup(partial);
		throw new Error("configuration failed");
	});
	const reconcile = vi.fn();
	vi.stubGlobal("reconcile", reconcile);
	mount();
	const report = vi.spyOn(runtime, "reportError").mockImplementation(() => {});
	runtime.page.applySwap("ab", markup("fail"), null);
	flushEffects();
	expect(partial).toHaveBeenCalledTimes(1);
	expect(reconcile).toHaveBeenCalledTimes(1);
	expect(final).not.toHaveBeenCalled();
	expect(report).toHaveBeenCalledTimes(1);
	if (outcome === "recovery") {
		runtime.page.applySwap("ab", markup("recover"), null);
		flushEffects();
	}
	runtime.page.dispose();
	expect(final).toHaveBeenCalledTimes(outcome === "removal" ? 1 : 0);
	expect(recovered).toHaveBeenCalledTimes(outcome === "recovery" ? 1 : 0);
});

it("cleans a failed reconciliation and continues finalizing after a finalizer throws", () => {
	const partial = vi.fn();
	const finalized: string[] = [];
	vi.stubGlobal("configure", (scope: EffectContext) => () => {
		finalized.push(scope.element.id);
		if (scope.element.id === "child") throw new Error("finalizer failed");
	});
	vi.stubGlobal("reconcile", (scope: EffectContext) => {
		scope.on_cleanup(partial);
		throw new Error("reconciliation failed");
	});
	const report = vi
		.spyOn(Runtime.prototype, "reportError")
		.mockImplementation(() => {});
	mount(
		markup().replace(
			"</dialog>",
			`${markup().replace('id="owned"', 'id="child"')}</dialog>`,
		),
	);
	expect(partial).toHaveBeenCalledTimes(2);
	runtime.page.dispose();
	expect(finalized).toEqual(["child", "owned"]);
	expect(report).toHaveBeenCalledTimes(3);
});

it.each([
	"morph",
	"hydrate",
])("does not orphan transferred resources when %s fails", (phase) => {
	const final = vi.fn();
	vi.stubGlobal("configure", () => final);
	vi.stubGlobal("reconcile", () => {});
	mount();
	if (phase === "morph") {
		const element = document.querySelector("dialog");
		if (!element) throw new Error("missing dialog");
		vi.spyOn(element, "setAttribute").mockImplementation(() => {
			throw new Error("morph failed");
		});
	}
	const next =
		phase === "morph"
			? markup().replace("<dialog ", '<dialog title="new" ')
			: `${markup()}<!--::topcoat::region::end(ff)-->`;
	expect(() => runtime.page.applySwap("ab", next, null)).toThrow();
	runtime.page.dispose();
	expect(final).toHaveBeenCalledTimes(1);
});

it("keeps candidates owned when invocation cleanup reenters disposal", () => {
	const final = vi.fn();
	vi.stubGlobal("configure", (scope: EffectContext) => {
		scope.on_cleanup(() => runtime.page.dispose());
		return final;
	});
	vi.stubGlobal("reconcile", () => {});
	mount();
	expect(() => runtime.page.applySwap("ab", markup(), null)).toThrow();
	flushEffects();
	expect(final).toHaveBeenCalledTimes(1);
	expect(runtime.page.isDisposed).toBe(true);
});

it("adopts every candidate before configuration cleanup can replace the content again", () => {
	const finalized: string[] = [];
	const html = markup().replace(
		"</dialog>",
		`${markup().replace('id="owned"', 'id="child"')}</dialog>`,
	);
	let replace = true;
	vi.stubGlobal("configure", (scope: EffectContext) => {
		scope.on_cleanup(() => {
			if (scope.element.id === "child" && replace) {
				replace = false;
				runtime.page.applySwap("ab", html, null);
			}
		});
		return () => finalized.push(scope.element.id);
	});
	vi.stubGlobal("reconcile", () => {});
	mount(html);
	const old = [...document.querySelectorAll("dialog")];
	expect(() => runtime.page.applySwap("ab", html, null)).toThrow();
	flushEffects();
	expect([...document.querySelectorAll("dialog")]).toEqual(old);
	expect(finalized).toEqual([]);
	runtime.page.dispose();
	expect(finalized).toEqual(["child", "owned"]);
});

it("ends native lifetimes on navigation commit even with identical markup", () => {
	const final = vi.fn();
	vi.stubGlobal("configure", () => final);
	vi.stubGlobal("reconcile", () => {});
	mount();
	const old = document.querySelector("dialog");
	runtime.page.replaceDocument(
		new DOMParser().parseFromString(
			`<html><head></head><body>${markup()}</body></html>`,
			"text/html",
		),
		newRender(),
	);
	flushEffects();
	expect(final).toHaveBeenCalledTimes(1);
	expect(document.querySelector("dialog")).not.toBe(old);
});

it.each([
	"failure",
	"commit",
])("keeps the displayed native owner during pending navigation, then handles %s", async (outcome) => {
	const final = vi.fn();
	vi.stubGlobal("configure", () => final);
	vi.stubGlobal("reconcile", () => {});
	const fallback = vi.spyOn(location, "assign").mockImplementation(() => {});
	let respond!: (response: Response) => void;
	vi.stubGlobal(
		"fetch",
		() =>
			new Promise<Response>((resolve) => {
				respond = resolve;
			}),
	);
	mount();
	const old = document.querySelector("dialog");
	const navigation = runtime.navigation.navigate(
		new URL("/lifecycle-next", location.href),
		"push",
	);
	await Promise.resolve();
	expect(final).not.toHaveBeenCalled();
	expect(document.querySelector("dialog")).toBe(old);
	if (outcome === "failure") respond(new Response("failure", { status: 500 }));
	else {
		const html = `<html><head>${document.head.innerHTML}</head><body>${markup()}</body></html>`;
		respond(
			new Response(`${JSON.stringify({ t: "snapshot", html })}\n`, {
				headers: { "Content-Type": "application/x-ndjson" },
			}),
		);
	}
	await navigation;
	flushEffects();
	if (outcome === "failure") {
		expect(final).not.toHaveBeenCalled();
		expect(document.querySelector("dialog")).toBe(old);
		expect(fallback).toHaveBeenCalled();
	} else {
		expect(final).toHaveBeenCalledTimes(1);
		expect(document.querySelector("dialog")).not.toBe(old);
	}
});
