import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	DEV_RUNTIME_EVENT,
	type DevRuntimeDetail,
} from "../../../topcoat-core/browser/dev";
import type { EffectContext } from "../src/dom/effect";
import { flushEffects, signal } from "../src/reactivity";
import { newRender, type ServerMessage } from "../src/render/frames";
import type { RenderUnit } from "../src/render/unit";
import { Runtime } from "../src/runtime";
import { F64 } from "../src/surrogate";

let runtime: Runtime;
let originalUrl: string;
let originalState: unknown;
let originalScrollRestoration: ScrollRestoration;

beforeEach(() => {
	originalUrl = location.href;
	originalState = history.state;
	originalScrollRestoration = history.scrollRestoration;
});

function mount(html: string): Runtime {
	document.body.innerHTML = html;
	runtime = new Runtime();
	runtime.start(document);
	return runtime;
}

function region(id: string, html: string): string {
	return `<!--::topcoat::region::start(${id})-->${html}<!--::topcoat::region::end(${id})-->`;
}

function shard(id: string, html: string, args = "[]"): string {
	return `<!--::topcoat::shard::start("/${id}", "${id}", ${args})-->${html}<!--::topcoat::shard::end("${id}")-->`;
}

const declaration =
	'<!--::topcoat::signal({"t":"signal","id":"month","v":1})-->';
const installed =
	'<button id="day" data-topcoat-after-render="hook">Day</button>';

function owner(id: string): RenderUnit {
	const unit = runtime.page.contentScope.findRegion(id)?.scope.unit;
	if (!unit) throw new Error(`Missing unit for ${id}`);
	return unit;
}

/** Keeps the harness's scripts and doctype compatible with real navigation. */
function page(html: string): string {
	const next = document.cloneNode(true) as Document;
	next.body.innerHTML = html;
	const doctype = next.doctype
		? new XMLSerializer().serializeToString(next.doctype)
		: "";
	return doctype + next.documentElement.outerHTML;
}

/** Each response remains pending until the test explicitly releases a frame. */
function stream() {
	let controller!: ReadableStreamDefaultController<Uint8Array>;
	const response = new Response(
		new ReadableStream<Uint8Array>({
			start(value) {
				controller = value;
			},
		}),
		{ headers: { "Content-Type": "application/x-ndjson" } },
	);
	return {
		response,
		push(frame: ServerMessage) {
			controller.enqueue(
				new TextEncoder().encode(`${JSON.stringify(frame)}\n`),
			);
		},
		close() {
			controller.close();
		},
	};
}

afterEach(() => {
	runtime?.navigation.dispose();
	runtime?.page.dispose();
	flushEffects();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	document.body.innerHTML = "";
	history.replaceState(originalState, "", originalUrl);
	history.scrollRestoration = originalScrollRestoration;
});

it("settles cascading bindings before callbacks and between callback writes", () => {
	const observed: string[] = [];
	vi.stubGlobal("effectHook", (context: EffectContext) => {
		context.after_dom(() => {
			observed.push(document.querySelector("input")?.value ?? "missing");
			runtime.context.signal("month").set(new F64(3));
		});
		context.after_dom(() => {
			observed.push(document.querySelector("input")?.value ?? "missing");
			context.after_dom(() => observed.push("nested"));
		});
	});
	mount(`${declaration}<section data-topcoat-effect="effectHook"></section>
		<input data-topcoat-bind:value="cx.signal('month').get()">
		<div data-topcoat-effect="scope => cx.signal('month').set(cx.hydrate(2))"></div>`);
	flushEffects();
	expect(observed).toEqual(["2", "3", "nested"]);
});

it("settles more than 100 independent after_dom writes before the final observer", () => {
	const observed: string[] = [];
	vi.stubGlobal("hook", (context: EffectContext) => {
		for (let value = 2; value <= 151; value++) {
			context.after_dom(() => {
				observed.push(document.querySelector("input")?.value ?? "missing");
				runtime.context.signal("month").set(new F64(value));
			});
		}
		context.after_dom(() => {
			observed.push(document.querySelector("input")?.value ?? "missing");
		});
	});
	mount(`${declaration}<section data-topcoat-effect="hook"></section>
		<input data-topcoat-bind:value="cx.signal('month').get()">`);
	expect.soft(flushEffects).not.toThrow();
	expect(runtime.context.signal("month").get()).toEqual(new F64(151));
	expect.soft(document.querySelector("input")?.value).toBe("151");
	expect(observed).toEqual(
		Array.from({ length: 151 }, (_, i) => String(i + 1)),
	);
});

it("settles independent after_dom branches that each schedule further work", () => {
	let observed = "missing";
	vi.stubGlobal("hook", (context: EffectContext) => {
		for (let value = 2; value <= 151; value++) {
			context.after_dom(() => {
				context.after_dom(() =>
					runtime.context.signal("month").set(new F64(value)),
				);
			});
		}
		context.after_dom(() => {
			context.after_dom(() => {
				observed = document.querySelector("input")?.value ?? "missing";
			});
		});
	});
	mount(`${declaration}<section data-topcoat-effect="hook"></section>
		<input data-topcoat-bind:value="cx.signal('month').get()">`);
	expect(flushEffects).not.toThrow();
	expect(runtime.context.signal("month").get()).toEqual(new F64(151));
	expect(document.querySelector("input")?.value).toBe("151");
	expect(observed).toBe("151");
});

it.each([
	1, 2,
])("bounds after_dom feedback through %i effects and recovers unrelated work", (count) => {
	const escapeLimit = 300;
	let callbacks = 0;
	let escaped = false;
	let feedback = true;
	const observed: number[] = [];
	const values = Array.from({ length: count }, () => signal(0));
	vi.stubGlobal(
		"hooks",
		values.map((value, index) => (context: EffectContext) => {
			const current = value();
			observed.push(current);
			if (!feedback) return;
			context.after_dom(() => {
				if (++callbacks === escapeLimit) {
					escaped = true;
					return;
				}
				values[(index + 1) % count]?.set(current + 1);
			});
		}),
	);
	let independent!: EffectContext;
	const unrelated = vi.fn(() =>
		runtime.context.signal("month").set(new F64(2)),
	);
	vi.stubGlobal("independent", (context: EffectContext) => {
		independent = context;
		context.after_dom(unrelated);
	});
	mount(`${declaration}<input data-topcoat-bind:value="cx.signal('month').get()">
			${values.map((_, index) => `<div data-topcoat-effect="hooks[${index}]"></div>`).join("")}
			<div data-topcoat-effect="independent"></div>`);
	const errors: unknown[] = [];
	vi.spyOn(runtime, "reportError").mockImplementation((error) =>
		errors.push(error),
	);
	try {
		flushEffects();
	} catch (error) {
		errors.push(error);
	}
	feedback = false;
	expect.soft(escaped).toBe(false);
	expect.soft(callbacks).toBeLessThan(escapeLimit);
	expect(callbacks).toBeGreaterThan(1);
	expect.soft(errors.length).toBeGreaterThan(0);
	for (const error of errors) expect(error).toBeInstanceOf(Error);
	expect(unrelated).toHaveBeenCalledTimes(1);
	expect(document.querySelector("input")?.value).toBe("2");

	// A later external update starts fresh, including for the stopped effect.
	const errorCount = errors.length;
	values[0]?.set(-1);
	independent.after_dom(() => runtime.context.signal("month").set(new F64(3)));
	expect(flushEffects).not.toThrow();
	expect(observed.at(-1)).toBe(-1);
	expect(errors).toHaveLength(errorCount);
	expect(document.querySelector("input")?.value).toBe("3");
});

it("bounds after_dom callback self-requeue without disabling its scope", () => {
	const escapeLimit = 300;
	let callbacks = 0;
	let escaped = false;
	let context!: EffectContext;
	const unrelated = vi.fn();
	vi.stubGlobal("hook", (value: EffectContext) => {
		context = value;
		const repeat = () => {
			if (++callbacks === escapeLimit) {
				escaped = true;
				return;
			}
			// EffectContext creates a new owned wrapper for every registration.
			context.after_dom(repeat);
		};
		context.after_dom(repeat);
		context.after_dom(unrelated);
	});
	mount('<section data-topcoat-effect="hook"></section>');
	const errors: unknown[] = [];
	vi.spyOn(runtime, "reportError").mockImplementation((error) =>
		errors.push(error),
	);
	try {
		flushEffects();
	} catch (error) {
		errors.push(error);
	}
	expect.soft(escaped).toBe(false);
	expect.soft(callbacks).toBeLessThan(escapeLimit);
	expect(callbacks).toBeGreaterThan(1);
	expect.soft(errors.length).toBeGreaterThan(0);
	for (const error of errors) expect(error).toBeInstanceOf(Error);
	expect(unrelated).toHaveBeenCalledTimes(1);
	const errorCount = errors.length;
	context.after_dom(unrelated);
	expect(flushEffects).not.toThrow();
	expect(errors).toHaveLength(errorCount);
	expect(unrelated).toHaveBeenCalledTimes(2);
});

it.each([
	false,
	true,
])("cancels queued insertion hooks when navigate starts (prefetched: %s)", async (prefetched) => {
	const response = stream();
	const fetch = vi.fn(() => Promise.resolve(response.response));
	vi.stubGlobal("fetch", fetch);
	const hook = vi.fn((context: EffectContext) => {
		(context.element as HTMLElement).focus();
	});
	vi.stubGlobal("hook", hook);
	mount(installed);
	const old = document.querySelector("button");
	const url = new URL("/scheduling-next", location.href);
	if (prefetched) {
		const link = document.createElement("a");
		link.href = url.href;
		expect(runtime.navigation.prefetch(link)).toBe(true);
	}
	const navigation = runtime.navigation.navigate(url, "replace");
	flushEffects();
	const pendingCalls = hook.mock.calls.length;
	const pendingFocus = document.activeElement === old;
	expect(document.querySelector("button")).toBe(old);
	response.push({ t: "snapshot", html: page(installed) });
	response.close();
	await navigation;
	flushEffects();
	expect.soft(pendingCalls).toBe(0);
	expect.soft(pendingFocus).toBe(false);
	expect(fetch).toHaveBeenCalledTimes(1);
	expect(hook).toHaveBeenCalledTimes(1);
	expect(document.activeElement).toBe(document.querySelector("button"));
	expect(location.href).toBe(url.href);
});

it("keeps initial insertion hooks runnable when only prefetch starts", async () => {
	const response = stream();
	vi.stubGlobal(
		"fetch",
		vi.fn(() => Promise.resolve(response.response)),
	);
	const hook = vi.fn();
	vi.stubGlobal("hook", hook);
	mount(installed);
	const link = document.createElement("a");
	link.href = new URL("/scheduling-prefetch", location.href).href;
	expect(runtime.navigation.prefetch(link)).toBe(true);
	flushEffects();
	expect(hook).toHaveBeenCalledTimes(1);
	response.close();
});

it("cancels insertion hooks when initialization starts a newer navigation", async () => {
	const first = stream();
	const second = stream();
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(first.response)
		.mockResolvedValueOnce(second.response);
	vi.stubGlobal("fetch", fetch);
	const hook = vi.fn((context: EffectContext) => {
		(context.element as HTMLElement).focus();
	});
	vi.stubGlobal("hook", hook);
	let newer: Promise<void> | undefined;
	const destination = new URL("/scheduling-newest", location.href);
	vi.stubGlobal("initialize", () => {
		newer = runtime.navigation.navigate(destination, "replace");
	});
	mount("<p>Home</p>");
	const navigation = runtime.navigation.navigate(
		new URL("/scheduling-intermediate", location.href),
		"replace",
	);
	first.push({
		t: "snapshot",
		html: page(`${installed}<div data-topcoat-effect="initialize"></div>`),
	});
	await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
	await navigation;
	flushEffects();
	const pendingCalls = hook.mock.calls.length;
	const pendingFocus =
		document.activeElement === document.querySelector("button");
	// An aborted navigation cannot resurrect its hooks with a later frame.
	first.push({ t: "snapshot", html: page(installed) });
	first.close();
	second.push({ t: "snapshot", html: page(installed) });
	second.close();
	await newer;
	flushEffects();
	expect.soft(pendingCalls).toBe(0);
	expect.soft(pendingFocus).toBe(false);
	expect(hook).toHaveBeenCalledTimes(1);
	expect(document.activeElement).toBe(document.querySelector("button"));
	expect(location.href).toBe(destination.href);
});

it("cancels the previous invocation's callback when a later effect reruns it", () => {
	const trigger = signal(0);
	const observed: number[] = [];
	let runs = 0;
	vi.stubGlobal("first", (context: EffectContext) => {
		const value = trigger();
		runs++;
		context.after_dom(() => observed.push(value));
	});
	vi.stubGlobal("second", () => trigger.set(1));
	mount(
		'<div data-topcoat-effect="first"></div><div data-topcoat-effect="second"></div>',
	);
	flushEffects();
	expect(runs).toBe(2);
	expect(observed).toEqual([1]);
});

it("does not subscribe to callback reads or repeat work without another request", async () => {
	const read = signal(0);
	let context!: EffectContext;
	const callback = vi.fn(() => read());
	const hook = vi.fn((value: EffectContext) => {
		context = value;
		value.after_dom(callback);
	});
	vi.stubGlobal("hook", hook);
	mount(installed);
	await Promise.resolve();
	read.set(1);
	flushEffects();
	expect(hook).toHaveBeenCalledTimes(1);
	expect(callback).toHaveBeenCalledTimes(1);
	context.after_dom(callback);
	expect(callback).toHaveBeenCalledTimes(1);
	await Promise.resolve();
	expect(callback).toHaveBeenCalledTimes(2);
});

it.each([
	"dispose",
	"detach",
	"replace",
])("skips queued callbacks on %s and rejects late registrations after disposal", (kind) => {
	let context!: EffectContext;
	const callback = vi.fn();
	vi.stubGlobal("hook", (value: EffectContext) => {
		context = value;
	});
	mount(installed);
	flushEffects();
	context.after_dom(callback);
	if (kind === "dispose") runtime.page.dispose();
	else if (kind === "detach") document.querySelector("button")?.remove();
	else runtime.page.replaceContent("<body>Gone</body>", newRender());
	flushEffects();
	context.after_dom(callback);
	flushEffects();
	expect(callback).not.toHaveBeenCalled();
});

it.each([
	"dispose",
	"detach",
	"replace",
])("skips initial insertion hooks on %s before settling", (kind) => {
	const hook = vi.fn();
	vi.stubGlobal("hook", hook);
	mount(installed);
	if (kind === "dispose") runtime.page.dispose();
	else if (kind === "detach") document.querySelector("button")?.remove();
	else runtime.page.replaceContent("<body>Gone</body>", newRender());
	flushEffects();
	expect(hook).not.toHaveBeenCalled();
});

it("runs an insertion hook after initialization effects and keeps its resources until replacement", () => {
	const reads = signal(0);
	const cleanup = vi.fn();
	const values: string[] = [];
	vi.stubGlobal("hook", (context: EffectContext) => {
		reads();
		values.push(context.element.querySelector("input")?.value ?? "missing");
		context.on_cleanup(cleanup);
	});
	const html = `${declaration}<section id="reused" data-topcoat-after-render="hook">
		<input data-topcoat-bind:value="cx.signal('month').get()">
		<div data-topcoat-effect="scope => cx.signal('month').set(cx.hydrate(2))"></div>
		</section>`;
	mount(region("aa", html));
	flushEffects();
	const element = document.querySelector("section");
	reads.set(1);
	flushEffects();
	expect(values).toEqual(["2"]);
	expect(cleanup).not.toHaveBeenCalled();
	runtime.page.applySwap("aa", html, null);
	expect(cleanup).toHaveBeenCalledTimes(1);
	flushEffects();
	expect(document.querySelector("section")).toBe(element);
	expect(values).toEqual(["2", "2"]);
	runtime.page.dispose();
	expect(cleanup).toHaveBeenCalledTimes(2);
});

it("does not confuse nested or independent owners, and rejects late frames", () => {
	const hook = vi.fn();
	vi.stubGlobal("hook", hook);
	mount(
		shard(
			"outer",
			region("aa", installed) + shard("inner", region("bb", installed)),
		) + shard("sibling", region("cc", installed)),
	);
	flushEffects();
	expect(hook).toHaveBeenCalledTimes(3);
	const inner = owner("bb");
	const render = newRender();
	inner.replaceContent(region("bb", installed), render);
	runtime.page.applySwap("bb", "stale page frame", null);
	owner("aa").applySwap("bb", "stale ancestor frame", null);
	runtime.page.applySwap("cc", installed, null);
	flushEffects();
	expect(hook).toHaveBeenCalledTimes(5);
	inner.applySwap("bb", installed, render);
	inner.applySwap("bb", installed, render);
	flushEffects();
	// The first of two synchronous replacements was disposed before running.
	expect(hook).toHaveBeenCalledTimes(6);
	expect(document.querySelectorAll("button")).toHaveLength(3);
});

it.each([
	"owner",
	"ancestor",
])("invalidates queued insertion hooks when a new %s request supersedes their content", async (kind) => {
	const response = stream();
	vi.stubGlobal(
		"fetch",
		vi.fn(() => Promise.resolve(response.response)),
	);
	const hook = vi.fn();
	const local = vi.fn();
	vi.stubGlobal("hook", hook);
	vi.stubGlobal("local", (context: EffectContext) => context.after_dom(local));
	mount(
		shard(
			"outer",
			region("aa", "") +
				shard(
					"inner",
					region("bb", `${installed}<div data-topcoat-effect="local"></div>`),
				),
		) + shard("sibling", region("cc", installed)),
	);
	const unit = owner(kind === "owner" ? "bb" : "aa");
	const completion = unit.refresh();
	flushEffects();
	expect(hook).toHaveBeenCalledTimes(1); // Independent sibling still initializes.
	expect(local).toHaveBeenCalledTimes(1); // Local work does not wait for requests.
	response.push({ t: "snapshot", html: installed });
	response.close();
	await completion;
	flushEffects();
	expect(hook).toHaveBeenCalledTimes(2);
});

it("invalidates hooks before a signal-triggered request's microtask starts", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(() => Promise.resolve(new Response("", { status: 500 }))),
	);
	const hook = vi.fn();
	vi.stubGlobal("hook", hook);
	mount(
		`${declaration}${shard("month", region("aa", installed), "[\"cx.signal('month').get()\"]")}`,
	);
	const report = vi.spyOn(runtime, "reportError").mockImplementation(() => {});
	runtime.context.signal("month").set(new F64(2));
	flushEffects();
	expect(hook).not.toHaveBeenCalled();
	await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1));
});

it("keeps queues usable after callback, initialization and cleanup errors", () => {
	const error = new Error("callback failure");
	const calls: string[] = [];
	vi.stubGlobal("hook", (context: EffectContext) => {
		context.on_cleanup(() => calls.push("cleaned"));
		context.on_cleanup(() => {
			throw error;
		});
		context.after_dom(() => calls.push("canceled"));
		throw error;
	});
	vi.stubGlobal("other", (context: EffectContext) => {
		context.after_dom(() => {
			throw error;
		});
		context.after_dom(() => calls.push("settled"));
	});
	mount(`${installed}<div data-topcoat-after-render="other"></div>`);
	const report = vi.spyOn(runtime, "reportError").mockImplementation(() => {});
	flushEffects();
	expect(calls).toEqual(["cleaned", "settled"]);
	expect(report).toHaveBeenCalledTimes(3);
	runtime.page.replaceContent(
		'<body><div data-topcoat-after-render="other"></div></body>',
		newRender(),
	);
	flushEffects();
	expect(calls).toEqual(["cleaned", "settled", "settled"]);
});

it("focuses only the accepted delayed month and rejects superseded HTTP frames", async () => {
	const stale = stream();
	const current = stream();
	const requests: RequestInit[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn((_url: string, init: RequestInit) => {
			requests.push(init);
			return Promise.resolve(
				requests.length === 1 ? stale.response : current.response,
			);
		}),
	);
	const focused: string[] = [];
	vi.stubGlobal("hook", (context: EffectContext) => {
		(context.element as HTMLElement).focus();
		focused.push(context.element.textContent ?? "");
	});
	mount(shard("month", region("aa", '<button id="day">Old month</button>')));
	flushEffects();
	const unit = owner("aa");
	const first = unit.refresh();
	await Promise.resolve();
	const second = unit.refresh();
	await Promise.resolve();
	expect(requests[0]?.signal?.aborted).toBe(true);
	expect(focused).toEqual([]);
	const button = document.querySelector("button");
	current.push({
		t: "snapshot",
		html: region("aa", installed.replace("Day", "Current month")),
	});
	await vi.waitFor(() => expect(focused).toEqual(["Current month"]));
	expect(document.activeElement).toBe(button); // Morph reused the node.
	stale.push({ t: "snapshot", html: installed.replace("Day", "Stale month") });
	stale.push({
		t: "swap",
		region: "aa",
		html: installed.replace("Day", "Stale day"),
	});
	stale.close();
	current.push({
		t: "swap",
		region: "aa",
		html: installed.replace("Day", "Current day"),
	});
	current.close();
	await Promise.all([first, second]);
	flushEffects();
	expect(focused).toEqual(["Current month", "Current day"]);
	expect(document.activeElement?.textContent).toBe("Current day");
});

it.each([
	"http",
	"frame",
])("does not invoke hooks on %s failure and allows the next request", async (kind) => {
	const failed = stream();
	const retry = stream();
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(
			kind === "http" ? new Response("", { status: 500 }) : failed.response,
		)
		.mockResolvedValueOnce(retry.response);
	vi.stubGlobal("fetch", fetch);
	const hook = vi.fn();
	vi.stubGlobal("hook", hook);
	mount(shard("month", region("aa", installed)));
	flushEffects();
	const unit = owner("aa");
	const rejection = expect(unit.refresh()).rejects.toThrow();
	failed.push({ t: "error", status: 500 });
	failed.close();
	await rejection;
	flushEffects();
	expect(hook).toHaveBeenCalledTimes(1);
	const completion = unit.refresh();
	retry.push({ t: "snapshot", html: installed });
	retry.close();
	await completion;
	flushEffects();
	expect(hook).toHaveBeenCalledTimes(2);
});

it("cancels pending requests and queued insertion work on navigation", async () => {
	const late = stream();
	vi.stubGlobal(
		"fetch",
		vi.fn(() => Promise.resolve(late.response)),
	);
	const hook = vi.fn();
	vi.stubGlobal("hook", hook);
	mount(shard("month", region("aa", installed)));
	const completion = owner("aa").refresh();
	runtime.page.replaceDocument(
		new DOMParser().parseFromString(
			"<html><head></head><body>Next page</body></html>",
			"text/html",
		),
		newRender(),
	);
	late.push({ t: "snapshot", html: installed });
	late.close();
	await completion;
	flushEffects();
	expect(hook).not.toHaveBeenCalled();
	expect(document.body.textContent).toBe("Next page");
});

it.each([
	"shard",
	"nested live",
	"owner live",
])("runs new %s insertion hooks after an enclosing request fails", async (kind) => {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValueOnce(new Response("", { status: 500 })),
	);
	const hook = vi.fn();
	vi.stubGlobal("hook", hook);
	mount(
		shard(
			"outer",
			region("aa", installed) + shard("inner", region("bb", installed)),
		),
	);
	flushEffects();
	const outer = owner("aa");
	const inner = owner("bb");
	const original = document.querySelector("button");
	await expect(outer.refresh()).rejects.toThrow();
	expect(document.querySelector("button")).toBe(original);
	if (kind === "shard") {
		const success = stream();
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(success.response));
		const completion = inner.refresh();
		success.push({ t: "snapshot", html: installed });
		success.close();
		await completion;
	} else {
		// The initial page stream still owns these regions. An independent
		// failed HTTP request does not cancel that original transport.
		runtime.page.applySwap(
			kind === "nested live" ? "bb" : "aa",
			installed,
			null,
		);
	}
	flushEffects();
	expect(hook).toHaveBeenCalledTimes(3);
});

it("settles callbacks that trigger further effects before the next insertion hook", () => {
	const values: string[] = [];
	vi.stubGlobal("first", () => runtime.context.signal("month").set(new F64(2)));
	vi.stubGlobal("initialize", (context: EffectContext) => {
		const value = runtime.context.signal("month").get();
		context.after_dom(() => values.push(String(value)));
	});
	vi.stubGlobal("hook", () =>
		values.push(document.querySelector("input")?.value ?? "missing"),
	);
	mount(`${declaration}<div data-topcoat-effect="initialize"></div>
		<div data-topcoat-after-render="first"></div>
		<input data-topcoat-bind:value="cx.signal('month').get()">
		${installed}`);
	flushEffects();
	// The old effect's callback is canceled by its rerun. The second hook
	// sees the updated binding before the new effect callback drains.
	expect(values).toEqual(["2", "2"]);
});

it("checks application intent when an accepted insertion preserves newer signals", () => {
	const focused: string[] = [];
	vi.stubGlobal("focusDay", (context: EffectContext) => {
		(context.element as HTMLElement).focus();
		focused.push(context.element.textContent ?? "");
	});
	const html = (
		month: number,
	) => `<button id="day" data-topcoat-after-render="scope => {
		if (cx.signal('month').get().dehydrate() === ${month}) focusDay(scope);
	}">Month ${month}</button>`;
	mount(`${declaration}${region("aa", html(1))}`);
	flushEffects();
	runtime.context.signal("month").set(new F64(2));
	runtime.page.applySwap("aa", html(1), null);
	flushEffects();
	expect(focused).toEqual(["Month 1"]);
	runtime.page.applySwap("aa", html(2), null);
	flushEffects();
	expect(focused).toEqual(["Month 1", "Month 2"]);
});

it("invalidates connected insertion hooks and rejects frames from stopped runs", async () => {
	let socket!: Socket;
	class Socket extends EventTarget {
		constructor() {
			super();
			socket = this;
		}
		readyState = 0;
		readonly sent: { run?: number; stop?: number }[] = [];
		send(data: string) {
			this.sent.push(JSON.parse(data));
		}
		close() {
			this.readyState = 3;
		}
		receive(run: number, frame: ServerMessage) {
			this.dispatchEvent(
				new MessageEvent("message", { data: JSON.stringify({ run, frame }) }),
			);
		}
	}
	vi.stubGlobal("WebSocket", Socket);
	const hook = vi.fn();
	vi.stubGlobal("hook", hook);
	const connected = "<!--::topcoat::connect-->";
	mount(region("aa", installed) + connected);
	window.dispatchEvent(new Event("load"));
	socket.readyState = 1;
	socket.dispatchEvent(new Event("open"));
	flushEffects();
	expect(hook).not.toHaveBeenCalled();
	expect(socket.sent).toHaveLength(1);
	const first = socket.sent[0]?.run;
	if (first === undefined) throw new Error("Missing connected run");
	await owner("aa").refresh();
	const second = socket.sent.at(-1)?.run;
	if (second === undefined) throw new Error("Missing replacement run");
	expect(second).not.toBe(first);
	socket.receive(first, { t: "snapshot", html: installed });
	flushEffects();
	expect(hook).not.toHaveBeenCalled();
	socket.receive(second, {
		t: "snapshot",
		html: `<body>${region("aa", installed)}${connected}</body>`,
	});
	flushEffects();
	expect(hook).toHaveBeenCalledTimes(1);
	socket.receive(first, { t: "swap", region: "aa", html: installed });
	flushEffects();
	expect(hook).toHaveBeenCalledTimes(1);
	socket.receive(second, { t: "swap", region: "aa", html: installed });
	flushEffects();
	expect(hook).toHaveBeenCalledTimes(2);
});

it("preserves an accepted insertion after a stream error and accepts a later render", async () => {
	const response = stream();
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response.response));
	const hook = vi.fn();
	vi.stubGlobal("hook", hook);
	mount(shard("month", region("aa", "Loading")));
	const unit = owner("aa");
	const completion = unit.refresh();
	const rejection = expect(completion).rejects.toThrow();
	response.push({ t: "snapshot", html: region("aa", installed) });
	await vi.waitFor(() => expect(hook).toHaveBeenCalledTimes(1));
	const accepted = document.querySelector("button");
	response.push({ t: "error", status: 500 });
	response.close();
	await rejection;
	expect(document.querySelector("button")).toBe(accepted);
	expect(hook).toHaveBeenCalledTimes(1);
	const next = stream();
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue(next.response));
	const retry = unit.refresh();
	next.push({ t: "snapshot", html: installed });
	next.close();
	await retry;
	flushEffects();
	expect(hook).toHaveBeenCalledTimes(2);
});

it("cancels pending insertion hooks when a dev render starts and initializes its replacement", async () => {
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("")));
	const hook = vi.fn();
	vi.stubGlobal("hook", hook);
	mount(installed);
	runtime.page.listenForDevRefresh();
	const detail: DevRuntimeDetail = {};
	window.dispatchEvent(new CustomEvent(DEV_RUNTIME_EVENT, { detail }));
	const dev = detail.runtime;
	if (!dev) throw new Error("Missing dev runtime");
	await dev.request(new AbortController().signal, Promise.resolve());
	flushEffects();
	expect(hook).not.toHaveBeenCalled();
	dev.replace(() => {
		document.body.innerHTML = installed;
	});
	flushEffects();
	expect(hook).toHaveBeenCalledTimes(1);
});
