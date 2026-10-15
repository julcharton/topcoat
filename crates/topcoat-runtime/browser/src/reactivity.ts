let activeEffect: Effect | null = null;
// Queue values retain the deepest callback ancestry when work is batched.
const pending = new Map<Effect, number>();
const settled = new Map<() => void, number>();
/** Settled callback phases on the current causal path, carried through effects. */
let callbackDepth = 0;
let scheduled = false;
let flushing = false;

function scheduleFlush(): void {
	if (scheduled || flushing) return;
	scheduled = true;
	queueMicrotask(() => {
		scheduled = false;
		flushEffects();
	});
}

/** Queues one untracked callback after reactive updates, returning its cancel. */
export function afterEffects(callback: () => void): () => void {
	// Bound feedback even when each iteration creates a new callback wrapper.
	// Siblings inherit the same depth rather than consuming each other's budget.
	if (callbackDepth >= 100) {
		throw new Error("Reactive callback cycle exceeded 100 phases");
	}
	settled.set(
		callback,
		Math.max(settled.get(callback) ?? 0, callbackDepth + 1),
	);
	scheduleFlush();
	return () => settled.delete(callback);
}

export interface WriteSignal<T> {
	(): T;
	set(value: T | ((previous: T) => T)): T;
}

/** A value whose reads subscribe the running effect to future changes. */
export function signal<T>(initial: T): WriteSignal<T> {
	let value = initial;
	const subscribers = new Set<Effect>();
	const read = () => {
		activeEffect?.track(subscribers);
		return value;
	};
	read.set = (next: T | ((previous: T) => T)): T => {
		const updated =
			typeof next === "function" ? (next as (previous: T) => T)(value) : next;
		// Preserve reference equality for surrogate objects, and !== semantics
		// for primitives (including NaN and signed zero).
		if (value !== updated) {
			value = updated;
			for (const effect of subscribers) effect.schedule();
		}
		return value;
	};
	return read;
}

/** Reads inside `fn` do not become dependencies of the running effect. */
export function untrack<T>(fn: () => T): T {
	const previous = activeEffect;
	activeEffect = null;
	try {
		return fn();
	} finally {
		activeEffect = previous;
	}
}

/**
 * A synchronous reaction that tracks its signal reads. Its owner must dispose
 * it when no longer needed. Creating an effect inside another does not link
 * their lifetimes.
 */
export class Effect {
	private readonly dependencies = new Set<Set<Effect>>();
	private disposed = false;
	private running = false;

	constructor(private readonly callback: () => void) {}

	track(subscribers: Set<Effect>): void {
		if (this.disposed) return;
		subscribers.add(this);
		this.dependencies.add(subscribers);
	}

	schedule(): void {
		// Writes during an effect notify other subscribers but do not schedule
		// the running effect again.
		if (this.disposed || this.running) return;
		pending.set(this, Math.max(pending.get(this) ?? 0, callbackDepth));
		scheduleFlush();
	}

	run(): void {
		if (this.disposed || this.running) return;
		const previousDepth = callbackDepth;
		callbackDepth = Math.max(callbackDepth, pending.get(this) ?? 0);
		pending.delete(this);
		this.unsubscribe();
		const previous = activeEffect;
		activeEffect = this;
		this.running = true;
		try {
			this.callback();
		} finally {
			this.running = false;
			activeEffect = previous;
			callbackDepth = previousDepth;
		}
	}

	dispose(): void {
		this.disposed = true;
		pending.delete(this);
		this.unsubscribe();
	}

	private unsubscribe(): void {
		for (const subscribers of this.dependencies) subscribers.delete(this);
		this.dependencies.clear();
	}
}

/** Drains scheduled updates synchronously; also used by the microtask queue. */
export function flushEffects(): void {
	if (flushing) return;
	flushing = true;
	const errors: unknown[] = [];
	const runs = new Map<Effect, number>();
	try {
		// Removing each entry before running it allows writes from other
		// effects to enqueue it again, while repeated writes stay batched.
		while (pending.size > 0 || settled.size > 0) {
			for (const effect of pending.keys()) {
				const count = (runs.get(effect) ?? 0) + 1;
				runs.set(effect, count);
				if (count > 100) {
					pending.delete(effect);
					errors.push(new Error("Reactive update cycle exceeded 100 runs"));
					continue;
				}
				try {
					effect.run();
				} catch (error) {
					errors.push(error);
				}
			}
			// Count reactive cycles per drain; callback depth bounds feedback
			// across drains without counting independent callback writes together.
			runs.clear();
			// A callback can write signals. Settle those writes before invoking
			// the next callback, including callbacks queued by other callbacks.
			const entry = settled.entries().next().value;
			if (entry !== undefined) {
				const [callback, depth] = entry;
				settled.delete(callback);
				const previousDepth = callbackDepth;
				callbackDepth = depth;
				try {
					untrack(callback);
				} catch (error) {
					errors.push(error);
				} finally {
					callbackDepth = previousDepth;
				}
			}
		}
	} finally {
		flushing = false;
	}
	// One broken binding must not prevent unrelated bindings from updating
	// or leave the scheduler stuck. Report errors after draining the queue.
	if (errors.length === 1) throw errors[0];
	if (errors.length > 1)
		throw new AggregateError(errors, "Reactive updates failed");
}
