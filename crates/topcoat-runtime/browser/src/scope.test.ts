import { afterEach, expect, it, vi } from "vitest";

import { flushEffects, signal } from "./reactivity";
import { Runtime } from "./runtime";
import { Scope } from "./scope";

const scopes: Scope[] = [];

function scope(): Scope {
	const owner = new Scope(null, new Runtime());
	scopes.push(owner);
	return owner;
}

afterEach(() => {
	for (const owner of scopes) owner.dispose();
	scopes.length = 0;
	flushEffects();
	vi.restoreAllMocks();
});

it("releases parent and child effects while keeping signals for adoption", () => {
	const parent = scope();
	const child = new Scope(parent, parent.runtime);
	parent.runtime.registry.insert("kept", 0);
	child.signalIds.add("kept");
	const value = parent.runtime.registry.handle("kept");
	const callback = vi.fn(() => value());
	parent.effect(callback);
	child.effect(callback);
	value.set(1);
	const replacement = new Scope(null, parent.runtime);
	scopes.push(replacement);
	replacement.replace(parent, (adoptable) => {
		expect(adoptable).toEqual(new Set(["kept"]));
		adoptable.delete("kept");
		replacement.signalIds.add("kept");
	});
	flushEffects();
	value.set(2);
	flushEffects();
	expect(callback).toHaveBeenCalledTimes(2);
	expect(parent.runtime.registry.read("kept")).toBe(2);
	expect(child.isDisposed).toBe(true);
	expect(parent.children.size).toBe(0);
});

it("cannot subscribe again after releasing itself during its first run", () => {
	const owner = scope();
	const value = signal(0);
	const callback = vi.fn(() => {
		value();
		owner.dispose();
		value();
	});
	owner.effect(callback);
	value.set(1);
	flushEffects();
	owner.effect(callback);
	expect(callback).toHaveBeenCalledTimes(1);
});

it("disposes a failed initial effect and restores tracking for later effects", () => {
	const owner = scope();
	const value = signal(0);
	const broken = vi.fn(() => {
		value();
		throw new Error("initial run failed");
	});
	expect(() => owner.effect(broken)).toThrow("initial run failed");
	const values: number[] = [];
	owner.effect(() => values.push(value()));
	value.set(1);
	flushEffects();
	expect(broken).toHaveBeenCalledTimes(1);
	expect(values).toEqual([0, 1]);
});

it.each([
	"cleanup",
	"insertion",
])("cannot delete signals transferred onward when obsolete %s throws", (phase) => {
	const previous = scope();
	const replacement = new Scope(null, previous.runtime);
	const latest = new Scope(null, previous.runtime);
	scopes.push(replacement, latest);
	previous.runtime.registry.insert("kept", 1);
	previous.runtime.registry.insert("removed", 2);
	previous.signalIds.add("kept");
	previous.signalIds.add("removed");
	const report = vi
		.spyOn(previous.runtime, "reportError")
		.mockImplementation(() => {});
	const supersede = () => {
		latest.replace(replacement, (adoptable) => {
			expect(adoptable.delete("kept")).toBe(true);
			latest.signalIds.add("kept");
		});
		throw new Error("obsolete callback failed");
	};
	if (phase === "cleanup") previous.onCleanup(supersede);
	const insert = vi.fn(phase === "insertion" ? supersede : () => {});
	expect(() => replacement.replace(previous, insert)).toThrow();
	expect(insert).toHaveBeenCalledTimes(phase === "insertion" ? 1 : 0);
	expect(report).toHaveBeenCalledTimes(phase === "cleanup" ? 1 : 0);
	expect(previous.runtime.registry.read("kept")).toBe(1);
	expect(previous.runtime.registry.has("removed")).toBe(false);
	latest.dispose();
	expect(previous.runtime.registry.has("kept")).toBe(false);
});

it.each([
	"dispose",
	"fail",
])("releases pending and declared signals when a reentrant replacement must %s", (outcome) => {
	const previous = scope();
	const replacement = new Scope(null, previous.runtime);
	const latest = new Scope(null, previous.runtime);
	scopes.push(replacement, latest);
	previous.runtime.registry.insert("a", 1);
	previous.runtime.registry.insert("b", 2);
	previous.signalIds.add("a");
	previous.signalIds.add("b");
	const report = vi
		.spyOn(previous.runtime, "reportError")
		.mockImplementation(() => {});
	previous.onCleanup(() =>
		latest.replace(replacement, (adoptable) => {
			adoptable.delete("a");
			latest.signalIds.add("a");
			if (outcome === "fail") throw new Error("insertion failed");
			latest.dispose();
		}),
	);
	const stale = vi.fn();
	expect(() => replacement.replace(previous, stale)).toThrow();
	expect(stale).not.toHaveBeenCalled();
	expect(report).toHaveBeenCalledTimes(outcome === "fail" ? 1 : 0);
	expect(previous.runtime.registry.has("a")).toBe(false);
	expect(previous.runtime.registry.has("b")).toBe(false);
	expect(latest.isDisposed).toBe(true);
});
