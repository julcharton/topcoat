import type { MorphOptions } from "../../../../topcoat-core/browser/morph";
import { compile } from "../expression/compile";
import { untrack } from "../reactivity";
import { Scope } from "../scope";
import { EffectContext, setupEffect } from "./effect";

export const ELEMENT_LIFECYCLE_ATTRIBUTE = "data-topcoat-element-lifecycle";

type Declaration = {
	configure: string;
	reconcile: string;
	attributes: string[];
};

/** Validate before claiming attributes or installing any native behavior. */
function declaration(element: Element): Declaration | null {
	const source = element.getAttribute(ELEMENT_LIFECYCLE_ATTRIBUTE);
	if (source === null) return null;
	const value: unknown = JSON.parse(source);
	if (
		typeof value !== "object" ||
		value === null ||
		!("configure" in value) ||
		typeof value.configure !== "string" ||
		!("reconcile" in value) ||
		typeof value.reconcile !== "string" ||
		!("attributes" in value) ||
		!Array.isArray(value.attributes)
	) {
		throw new Error("Invalid element lifecycle declaration");
	}
	const attributes = new Set<string>();
	for (const name of value.attributes) {
		if (
			typeof name !== "string" ||
			!/^[a-z0-9-]+$/.test(name) ||
			name === "id" ||
			name.startsWith("data-topcoat-") ||
			element.hasAttribute(`data-topcoat-bind:${name}`)
		) {
			throw new Error("Invalid or bound live attribute");
		}
		attributes.add(name);
	}
	return {
		configure: value.configure,
		reconcile: value.reconcile,
		attributes: [...attributes].sort(),
	};
}

/** A native element's latest teardown declaration, always owned by a Scope. */
export class ElementLifecycle {
	private configuration: Scope | null = null;
	private finalize: (() => void) | null = null;
	private disposed = false;
	readonly attributes: ReadonlySet<string>;
	private readonly id: string;

	constructor(
		readonly element: Element,
		private owner: Scope,
		claims: string[],
	) {
		this.attributes = new Set(claims);
		this.id = element.id;
		owner.elements.set(element, this);
	}

	compatible(incoming: Element): boolean {
		if (
			this.disposed ||
			this.id !== incoming.id ||
			this.element.localName !== incoming.localName ||
			this.element.namespaceURI !== incoming.namespaceURI
		)
			return false;
		try {
			const next = declaration(incoming);
			return (
				next !== null &&
				next.attributes.length === this.attributes.size &&
				next.attributes.every((name) => this.attributes.has(name))
			);
		} catch {
			return false;
		}
	}

	/** Transfer ownership without callbacks; the old scope releases configuration. */
	adopt(owner: Scope): void {
		if (this.disposed) return;
		this.owner.elements.delete(this.element);
		this.owner = owner;
		owner.elements.set(this.element, this);
		if (owner.isDisposed) this.dispose();
	}

	configure(next: Declaration): void {
		const configuration = this.configuration;
		this.configuration = null;
		configuration?.dispose();
		if (this.disposed || this.owner.isDisposed) return;
		const scope = new Scope(this.owner, this.owner.runtime, this.owner.unit);
		this.configuration = scope;
		scope.effect(
			() =>
				untrack(() => {
					try {
						if (!this.element.isConnected) return;
						const configure = compile<(context: EffectContext) => () => void>(
							next.configure,
							"element lifecycle",
						);
						const finalize = configure(scope.runtime.context)(
							new EffectContext(this.element, scope),
						);
						if (typeof finalize !== "function")
							throw new Error("Element configuration must return a finalizer");
						if (scope.isDisposed) return;
						this.finalize = finalize;
						setupEffect(this.element, next.reconcile, scope);
					} catch (error) {
						scope.dispose();
						scope.runtime.reportError(error);
					}
				}),
			{ defer: true },
		);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.owner.elements.delete(this.element);
		this.configuration?.dispose();
		this.configuration = null;
		const finalize = this.finalize;
		this.finalize = null;
		try {
			if (finalize) untrack(finalize);
		} catch (error) {
			this.owner.runtime.reportError(error);
		}
	}
}

export function setupElementLifecycle(element: Element, scope: Scope): void {
	const next = declaration(element);
	if (next === null || scope.isDisposed) return;
	let resource: ElementLifecycle | undefined;
	for (let current: Scope | null = scope; current; current = current.parent) {
		resource = current.elements.get(element);
		if (resource) break;
	}
	if (resource) resource.adopt(scope);
	else resource = new ElementLifecycle(element, scope, next.attributes);
	resource.configure(next);
}

/** Runtime ownership policy; the shared morpher knows nothing about resources. */
export function elementMorph(scope: Scope, retain = true): MorphOptions {
	// These are lookup references only. Scope retains ownership throughout morph.
	const resources = scope.collectElements();
	const byElement = new Map(
		resources.map((resource) => [resource.element, resource]),
	);
	const active = () => {
		if (scope.isDisposed) throw new Error("Content was disposed during morph");
	};
	return {
		canReuseElement(current, incoming, wouldDisconnect) {
			active();
			if (
				wouldDisconnect &&
				resources.some((resource) => current.contains(resource.element))
			)
				return false;
			const resource = byElement.get(current);
			return (
				resource === undefined || (retain && resource.compatible(incoming))
			);
		},
		preserveAttributes(current) {
			return byElement.get(current)?.attributes ?? new Set();
		},
		beforeRemove(node) {
			active();
			for (const resource of resources) {
				if (node.contains(resource.element)) {
					resource.dispose();
				}
			}
			active();
		},
	};
}
