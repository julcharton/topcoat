import "../../tests/scheduling";

import { expect, it, vi } from "vitest";
import { flushEffects } from "../reactivity";
import { Runtime } from "../runtime";
import { Bool } from "../surrogate";
import type { EffectContext } from "./effect";

it("scrolls a locally filtered option only after its visibility binding settles", () => {
	const runtime = new Runtime();
	let scrolled = false;
	vi.stubGlobal("scrollHook", (context: EffectContext) => {
		const show = runtime.context.signal("show").get();
		if (!(show instanceof Bool) || !show.dehydrate()) return;
		context.after_dom(() => {
			const option = context.element.querySelector<HTMLElement>("#option");
			if (!option) throw new Error("Missing option");
			expect(option.hidden).toBe(false);
			expect(option.getBoundingClientRect().height).toBeGreaterThan(0);
			option.scrollIntoView({ block: "nearest" });
			scrolled = true;
		});
	});
	document.body.innerHTML = `<!--::topcoat::signal({"t":"signal","id":"show","v":false})-->
		<div id="list" style="height:80px;overflow:auto" data-topcoat-effect="scrollHook">
		<div style="height:300px"></div>
		<button id="option" hidden data-topcoat-bind:hidden="cx.signal('show').get().not()">Option</button>
		</div>`;
	try {
		runtime.start(document);
		flushEffects();
		runtime.context.signal("show").set(new Bool(true));
		flushEffects();
		expect(scrolled).toBe(true);
		expect(document.querySelector("#list")?.scrollTop).toBeGreaterThan(0);
	} finally {
		runtime.page.dispose();
		vi.unstubAllGlobals();
		document.body.innerHTML = "";
	}
});
