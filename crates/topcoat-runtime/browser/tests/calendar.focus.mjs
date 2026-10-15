// Native pointer opening can leave BODY focused, particularly in WebKit.
import assert from "node:assert/strict";
import {
	active,
	eventually,
	holdResponses,
	input,
	open,
	picker,
	range,
	settled,
	trigger,
} from "./calendar.helpers.mjs";

export function focusRegressions(test) {
	for (const [title, target] of [
		["Shift+Tab to the input", input],
		["an outside button", "#outside"],
		["another picker input", `${range} input[name=start]`],
	]) {
		test(`pointer opening respects newer focus on ${title}`, async (page) => {
			await page.locator(input).focus();
			const held = await holdResponses(page);
			// Do not focus the trigger first: native pointer focus is the regression.
			await page.locator(trigger(picker)).click();
			await held.wait();
			if (target === input) await page.keyboard.press("Shift+Tab");
			else await page.locator(target).focus();
			const ownsFocus = () =>
				page
					.locator(target)
					.evaluate((node) => node === document.activeElement);
			assert.equal(await ownsFocus(), true, "the newer target owns focus");
			await held.release();
			await settled(page);
			assert.equal(
				await ownsFocus(),
				true,
				"the opening response preserves the newer focus owner",
			);
			assert.equal(
				await page
					.locator(`${picker} [popover]`)
					.evaluate((panel) => panel.matches(":popover-open")),
				true,
				"focus movement alone keeps the native popup open",
			);
			await page.keyboard.press("Escape");
			await open(page);
		});
	}

	test("a second pointer-opened instance owns focus after stale responses", async (page) => {
		// This trigger is outside the first popup's native hit area.
		const second = "#external-picker";
		await page.locator(input).focus();
		const held = await holdResponses(page);
		await page.locator(trigger(picker)).click();
		await held.wait();
		await page.locator(trigger(second)).click();
		await held.wait(2);
		await held.release();
		await settled(page, picker);
		await settled(page, second);
		await active(page, "2024-02-01");
		assert.equal(
			await page
				.locator(`${second} [popover]`)
				.evaluate(
					(panel) =>
						panel.matches(":popover-open") &&
						panel.contains(document.activeElement),
				),
			true,
			"the latest instance owns the open popup and focused date",
		);
		assert.equal(
			await page
				.locator(`${picker} [popover]`)
				.evaluate((panel) => panel.matches(":popover-open")),
			false,
		);
		await page.keyboard.press("Escape");
		await open(page);
	});

	test("removal releases pointer focus ownership before stale responses", async (page) => {
		await page.addInitScript(() => {
			window.focusSignals = [];
			const original = EventTarget.prototype.addEventListener;
			EventTarget.prototype.addEventListener = function (
				type,
				listener,
				options,
			) {
				if (this === document && type === "focusin" && options?.signal)
					window.focusSignals.push(options.signal);
				return original.call(this, type, listener, options);
			};
		});
		await page.reload();
		await page.waitForLoadState("networkidle");
		const listeners = () =>
			page.evaluate(
				() => window.focusSignals.filter((signal) => !signal.aborted).length,
			);
		const baseline = await listeners();
		assert(baseline >= 2, "installed pickers own scoped focus listeners");
		const first = '[data-instance="1"]';
		await page.locator(`${first} input`).focus();
		const held = await holdResponses(page);
		await page.locator(trigger(first)).click();
		await held.wait();
		// Let the compiled removal finish while the old opening response stays held.
		await page.unroute("**/_topcoat/runtime/shards/**");
		await page.locator("#remove").click();
		await page.locator(first).waitFor({ state: "detached" });
		await eventually(
			async () => (await listeners()) === baseline - 2,
			"removed instances release their focus listeners",
		);
		await page.locator("#outside").focus();
		await held.release();
		await page.waitForLoadState("networkidle");
		assert.equal(await page.locator(first).count(), 0);
		assert.equal(
			await page
				.locator("#outside")
				.evaluate((node) => node === document.activeElement),
			true,
		);
		await page.locator("#remove").click();
		await page.locator(`${first} input`).waitFor();
		await eventually(
			async () => (await listeners()) === baseline,
			"replacement instances install only their own listeners",
		);
		await open(page, first, "2024-01-15");
		await page.keyboard.press("Escape");
		await open(page);
	});
}
