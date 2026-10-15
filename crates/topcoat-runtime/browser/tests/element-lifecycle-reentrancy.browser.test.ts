import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EffectContext } from "../src/dom/effect";
import { ELEMENT_LIFECYCLE_ATTRIBUTE } from "../src/dom/element-lifecycle";
import { flushEffects } from "../src/reactivity";
import { newRender } from "../src/render/frames";
import { Runtime } from "../src/runtime";

let runtime: Runtime;
let original: string;
let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	original = document.documentElement.outerHTML;
	runtime = new Runtime();
	errors = vi.spyOn(runtime, "reportError").mockImplementation(() => {});
});

afterEach(() => {
	runtime.navigation.dispose();
	runtime.page.dispose();
	flushEffects();
	const reported = errors.mock.calls;
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	const saved = new DOMParser().parseFromString(original, "text/html");
	document.replaceChild(saved.documentElement, document.documentElement);
	expect(reported).toEqual([]);
});

function attachment(
	configure = "configure",
	reconcile = "() => {}",
	attributes: string[] = [],
): string {
	const source = JSON.stringify({
		configure,
		reconcile,
		attributes,
	}).replaceAll('"', "&quot;");
	return `${ELEMENT_LIFECYCLE_ATTRIBUTE}="${source}"`;
}

const region = (html: string) =>
	`<!--::topcoat::region::start(ab)-->${html}<!--::topcoat::region::end(ab)-->`;
const signal = (id: string, value: boolean) =>
	`<!--::topcoat::signal({"t":"signal","id":"${id}","v":${value}})-->`;
const element = (id: string) => {
	const found = document.getElementById(id);
	if (!found) throw new Error(`Missing ${id}`);
	return found;
};

function start(html: string): void {
	document.body.innerHTML = html;
	runtime.start(document);
	flushEffects();
}

it.each([
	"region",
	"page",
	"shard",
])("transfers real signal ownership before reentrant %s configuration cleanup", (kind) => {
	const reads: boolean[] = [];
	const stale = vi.fn();
	const final = vi.fn();
	vi.stubGlobal("recordRead", (value: boolean) => reads.push(value));
	vi.stubGlobal("freshConfigure", () => final);
	const reconcile = "() => recordRead(cx.signal('a').get().dehydrate())";
	const next = `${signal("a", false)}<div id="owned" ${attachment("freshConfigure", reconcile)}></div>`;
	let replace!: (html: string) => void;
	let configured!: EffectContext;
	vi.stubGlobal("configure", (scope: EffectContext) => {
		configured = scope;
		scope.on_cleanup(() => replace(next));
		return final;
	});
	const initial = `${signal("a", true)}${signal("b", false)}<div id="owned" ${attachment("configure", reconcile)}></div>`;
	start(
		kind === "shard"
			? `<!--::topcoat::shard::start("/shard", "0", [])-->${region(initial)}<!--::topcoat::shard::end("0")-->`
			: region(initial),
	);
	const unit = runtime.page.contentScope.findRegion("ab")?.scope.unit;
	if (!unit) throw new Error("Missing unit");
	replace =
		kind === "region"
			? (html) => runtime.page.applySwap("ab", html, null)
			: (html) =>
					unit.replaceContent(
						kind === "page"
							? `<html><head>${document.head.innerHTML}</head><body>${html}</body></html>`
							: html,
						newRender(),
					);
	const node = element("owned");
	const handle = runtime.registry.handle("a");
	stale.mockClear();
	configured.after_dom(stale);
	// Queue an obsolete reconciliation before cleanup accepts different content.
	handle.set(runtime.context.hydrate(true));
	try {
		replace("<p>obsolete outer replacement</p>");
	} catch {
		/* Superseded work may abort. */
	}
	flushEffects();
	expect(runtime.registry.has("a")).toBe(true);
	expect(runtime.registry.handle("a")).toBe(handle);
	expect(runtime.registry.has("b")).toBe(false);
	expect(element("owned")).toBe(node);
	expect(reads).toEqual([true, true]);
	expect(stale).not.toHaveBeenCalled();
	expect(final).not.toHaveBeenCalled();
	handle.set(runtime.context.hydrate(false));
	flushEffects();
	expect(reads).toEqual([true, true, false]);
	runtime.page.dispose();
	expect(runtime.registry.has("a")).toBe(false);
	expect(final).toHaveBeenCalledTimes(1);
});

it.each([
	"removal",
	"failed hydration",
])("stops obsolete ancestor retirement during %s when child finalization restores the subtree", (cause) => {
	const configured: string[] = [];
	const finalized: string[] = [];
	const html = `<section id="parent" ${attachment()}><div id="child" ${attachment()}></div></section>`;
	let restore = true;
	vi.stubGlobal("configure", (scope: EffectContext) => {
		configured.push(scope.element.id);
		return () => {
			expect(scope.element.isConnected).toBe(true);
			finalized.push(scope.element.id);
			if (scope.element.id === "child" && restore) {
				restore = false;
				runtime.page.applySwap("ab", html, null);
			}
		};
	});
	start(region(html));
	const parent = element("parent");
	const child = element("child");
	const obsolete =
		cause === "removal" ? "" : `${html}<!--::topcoat::region::end(ff)-->`;
	expect(() => runtime.page.applySwap("ab", obsolete, null)).toThrow();
	flushEffects();
	expect(finalized).toEqual(["child"]);
	expect(element("parent")).toBe(parent);
	expect(element("child")).not.toBe(child);
	expect(configured).toEqual(["parent", "child", "parent", "child"]);
	runtime.page.dispose();
	expect(finalized).toEqual(["child", "child", "parent"]);
});

it("isolates a retiring dialog's queued close from reentrant replacement handlers", async () => {
	const closes = vi.fn();
	const retiredClose = vi.fn();
	const final = vi.fn();
	vi.stubGlobal("replacementClose", closes);
	vi.stubGlobal("freshConfigure", (scope: EffectContext) => () => {
		final();
		(scope.element as HTMLDialogElement).close();
	});
	const next = `<dialog id="owned" ${attachment("freshConfigure", "scope => scope.element.showModal()", ["open"])} data-topcoat-on:close="() => replacementClose()"></dialog>`;
	vi.stubGlobal("configure", (scope: EffectContext) => () => {
		expect(scope.element.isConnected).toBe(true);
		(scope.element as HTMLDialogElement).close();
		runtime.page.applySwap("ab", next, null);
	});
	start(
		region(
			`<dialog id="owned" ${attachment("configure", "scope => scope.element.showModal()", ["open"])}></dialog>`,
		),
	);
	const old = element("owned");
	old.addEventListener("close", retiredClose);
	expect(() => runtime.page.applySwap("ab", "", null)).toThrow();
	flushEffects();
	const current = element("owned") as HTMLDialogElement;
	// Observe the actual queued native event before checking handler isolation.
	await expect.poll(() => retiredClose.mock.calls.length).toBe(1);
	expect(closes).not.toHaveBeenCalled();
	expect(current).not.toBe(old);
	expect(current.matches(":modal")).toBe(true);
	current.close();
	await expect.poll(() => closes.mock.calls.length).toBe(1);
	runtime.page.dispose();
	expect(final).toHaveBeenCalledTimes(1);
});

it.each([
	"dispose",
	"fail",
])("cleans transferred signals and native resources when configuration cleanup reenters %s", (outcome) => {
	const final = vi.fn();
	const stale = vi.fn();
	const html = `${signal("a", true)}<div id="owned" ${attachment("configure", "stale")}></div>`;
	vi.stubGlobal("stale", stale);
	vi.stubGlobal("configure", (scope: EffectContext) => {
		scope.on_cleanup(() => {
			if (outcome === "dispose") runtime.page.dispose();
			else
				runtime.page.applySwap(
					"ab",
					`${html}<!--::topcoat::region::end(ff)-->`,
					null,
				);
		});
		return final;
	});
	start(region(html));
	stale.mockClear();
	expect(() => runtime.page.applySwap("ab", html, null)).toThrow();
	flushEffects();
	expect(stale).not.toHaveBeenCalled();
	expect(runtime.registry.has("a")).toBe(false);
	expect(runtime.page.contentScope.collectElements()).toHaveLength(0);
	runtime.page.dispose();
	expect(final).toHaveBeenCalledTimes(1);
	expect(errors).toHaveBeenCalledTimes(outcome === "fail" ? 1 : 0);
	errors.mockClear();
});

it.each([
	"html",
	"head",
	"body",
])("refreshes and removes accepted %s envelope lifecycle declarations", (tag) => {
	const captures: string[] = [];
	const final = vi.fn();
	for (const name of ["first", "second"]) {
		vi.stubGlobal(name, () => {
			captures.push(name);
			return final;
		});
	}
	const initial = document.querySelector(tag);
	if (!initial) throw new Error("Missing envelope");
	initial.setAttribute(
		ELEMENT_LIFECYCLE_ATTRIBUTE,
		JSON.stringify({
			configure: "first",
			reconcile: "() => {}",
			attributes: [],
		}),
	);
	start("<p>initial</p>");
	const snapshot = (configure?: string) => {
		const next = new DOMParser().parseFromString(
			document.documentElement.outerHTML,
			"text/html",
		);
		const envelope = next.querySelector(tag);
		if (!envelope) throw new Error("Missing incoming envelope");
		if (configure)
			envelope.setAttribute(
				ELEMENT_LIFECYCLE_ATTRIBUTE,
				JSON.stringify({ configure, reconcile: "() => {}", attributes: [] }),
			);
		else envelope.removeAttribute(ELEMENT_LIFECYCLE_ATTRIBUTE);
		next.body.innerHTML = "<p>accepted</p>";
		runtime.page.replaceContent(next.documentElement.outerHTML, newRender());
		flushEffects();
	};
	snapshot("second");
	expect(document.querySelector(tag)).toBe(initial);
	expect(captures).toEqual(["first", "second"]);
	expect(final).not.toHaveBeenCalled();
	snapshot();
	expect(document.querySelector(tag)).not.toBe(initial);
	expect(final).toHaveBeenCalledTimes(1);
	expect(runtime.page.contentScope.collectElements()).toHaveLength(0);
	runtime.page.dispose();
	expect(final).toHaveBeenCalledTimes(1);
});
